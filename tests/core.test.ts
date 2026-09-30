import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { configPath, loadConfig, promptPath, saveConfig } from '../src/core/config';
import { gitApiBase, parseTarget, tokenCreationUrl } from '../src/core/target';
import { serviceFetch } from '../src/core/network';
import { fetchReview, makePatch } from '../src/core/providers';
import { analyze, complete, summarizeRepository, validateRangeLayers } from '../src/core/analysis';
import { changeUnits } from '../src/core/changes';
import { repositoryReader } from '../src/core/repository';
import { demoSession } from '../src/core/demo';
import { startServer } from '../src/server';

const servers: ReturnType<typeof Bun.serve>[] = [];
const blob = (text: string) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
function mock(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  servers.push(server); return server.url.origin;
}

describe('URL routing and authentication', () => {
  test('recognizes nested self-hosted GitLab projects and GitHub Enterprise', () => {
    expect(parseTarget('https://git.company/team/sub/project/-/merge_requests/23/diffs').project).toBe('team/sub/project');
    expect(parseTarget('https://github.company/org/repo/pull/7/files').provider).toBe('github');
    expect(gitApiBase({ provider: 'github', baseUrl: 'https://github.company' })).toBe('https://github.company/api/v3');
    expect(gitApiBase({ provider: 'github', baseUrl: 'https://github.com' })).toBe('https://api.github.com');
    expect(tokenCreationUrl('gitlab', 'https://git.company/gitlab')).toContain('/gitlab/-/user_settings/personal_access_tokens');
  });
  test('rejects credential-bearing URLs and provider mismatches', () => {
    expect(() => parseTarget('https://secret:token@git.company/a/b/-/merge_requests/1')).toThrow();
    expect(() => parseTarget('https://git.company/a/b/-/merge_requests/1', 'github')).toThrow();
    expect(() => parseTarget('https://git.company/a/b/-/merge_requests/0')).toThrow();
  });
  test('saves only credentials, with restricted file permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'change-stack-config-'));
    try {
      const path = join(dir, 'config.json');
      expect(await loadConfig(path)).toEqual({ version: 1, hosts: {} });
      const config = { version: 1 as const, hosts: { 'https://git.company': { provider: 'gitlab' as const, baseUrl: 'https://git.company', token: 'test-token' } } };
      await saveConfig(config, path); expect(await loadConfig(path)).toEqual({ ...config, defaultLanguage: 'en' });
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(configPath()).toBeTruthy();
    } finally { await rm(dir, { recursive: true }); }
  });
  test('blocks unconfigured origins and does not follow service redirects', async () => {
    let forwarded = false;
    const destination = mock(() => { forwarded = true; return Response.json({ ok: true }); });
    const origin = mock(() => Response.redirect(destination));
    await expect(serviceFetch(destination, origin)).rejects.toThrow('Blocked');
    await expect(serviceFetch(origin, origin, { headers: { Authorization: 'Bearer secret' } })).rejects.toThrow();
    expect(forwarded).toBe(false);
  });
});

describe('Git providers', () => {
  test('paginates GitLab diffs and recovers omitted text with host credentials', async () => {
    const paths: string[] = [];
    const origin = mock(request => {
      expect(request.headers.get('PRIVATE-TOKEN')).toBe('gitlab-token');
      const url = new URL(request.url); paths.push(url.pathname + url.search);
      if (url.pathname.endsWith('/diffs')) {
        return Response.json(Array.from({ length: url.searchParams.get('page') === '1' ? 100 : 1 }, (_, i) => ({
          old_path: `${url.searchParams.get('page')}-${i}.ts`, new_path: `${url.searchParams.get('page')}-${i}.ts`,
          diff: i === 0 ? '' : '@@ -1 +1 @@\n-old\n+new\n', too_large: i === 0,
        })));
      }
      if (url.pathname.endsWith('/repository/tree')) return Response.json(
        (url.searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => `1-${i}.ts`) : ['2-0.ts'])
          .map(path => ({ path, type: 'blob', id: blob(url.searchParams.get('ref') === 'abc' ? 'new\n' : 'old\n'), mode: '100644' })));
      if (url.pathname.endsWith('/raw')) return new Response(url.pathname.includes(blob('new\n')) ? 'new\n' : 'old\n');
      return Response.json({ title: 'Test', author: { username: 'dev' }, diff_refs: { head_sha: 'abc', base_sha: 'base' }, source_branch: 'feature', target_branch: 'main', changes_count: '101' });
    });
    const review = await fetchReview(parseTarget(`${origin}/team/sub/project/-/merge_requests/1`), { provider: 'gitlab', baseUrl: origin, token: 'gitlab-token' });
    expect(review.files).toHaveLength(101); expect(review.files.every(file => !file.incomplete)).toBe(true);
    expect(review.files[0]!.patch).toContain('+new'); expect(review.warnings).toEqual([]);
    expect(paths.some(p => p.includes('team%2Fsub%2Fproject'))).toBe(true);
    expect(paths.some(p => p.endsWith('page=2'))).toBe(true);
  });
  test('normalizes GitHub renames and recovers files missing from the API list', async () => {
    const origin = mock(request => {
      expect(request.headers.get('authorization')).toBe('Bearer github-token');
      const url = new URL(request.url);
      if (url.pathname.includes('/compare/')) return Response.json({ merge_base_commit: { sha: 'merge-base' } });
      if (url.pathname.includes('/git/trees/')) return Response.json({ tree: (url.pathname.endsWith('/merge-base') ? ['old.ts'] : ['new.ts', 'missing.ts'])
        .map(path => ({ path, type: 'blob', sha: blob(path === 'missing.ts' ? 'added\n' : path === 'old.ts' ? 'old\n' : 'new\n'), mode: '100644' })), truncated: false });
      if (url.pathname.includes('/git/blobs/')) return new Response(url.pathname.endsWith(blob('added\n')) ? 'added\n' : url.pathname.endsWith(blob('old\n')) ? 'old\n' : 'new\n');
      return new URL(request.url).pathname.endsWith('/files') ? Response.json([{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new\n' }])
        : Response.json({ title: 'Rename', body: '', user: { login: 'dev' }, head: { sha: 'abc', ref: 'feature' }, base: { sha: 'base', ref: 'main' }, changed_files: 2 });
    });
    const review = await fetchReview(parseTarget(`${origin}/owner/repo/pull/2`), { provider: 'github', baseUrl: origin, token: 'github-token' });
    expect(review.baseSha).toBe('merge-base'); expect(review.baseRepository).toBe('owner/repo');
    expect(review.files[0]!.status).toBe('renamed'); expect(review.files[0]!.patch).toContain('a/old.ts');
    expect(review.files[1]!.path).toBe('missing.ts'); expect(review.files[1]!.patch).toContain('+added'); expect(review.warnings).toEqual([]);
  });
  test('refuses a diff whose head changed while fetching', async () => {
    let calls = 0;
    const origin = mock(request => /\/(diffs|tree)$/.test(new URL(request.url).pathname) ? Response.json([]) : Response.json({ diff_refs: { head_sha: ++calls === 1 ? 'before' : 'after', base_sha: 'base' } }));
    await expect(fetchReview(parseTarget(`${origin}/a/b/-/merge_requests/1`), { provider: 'gitlab', baseUrl: origin, token: 'test' })).rejects.toThrow('changed while loading');
  });
});

describe('Grounded model output and local sessions', () => {
  test('requests high reasoning and Flex without incompatible sampling parameters', async () => {
    const origin = mock(async request => {
      const body = await request.json() as any;
      expect(body.service_tier).toBe('flex');
      expect(body.reasoning_effort).toBe('high');
      expect(body.temperature).toBeUndefined();
      return Response.json({ service_tier: 'flex', choices: [{ message: { content: 'Verified response' } }] });
    });
    expect(await complete({ baseUrl: `${origin}/v1`, model: 'gpt-6-luna', apiKey: 'test', reasoningEffort: 'high', serviceTier: 'flex' }, 'Explain the supplied patch')).toBe('Verified response');
  });
  test('refuses a result when the endpoint does not confirm Flex processing', async () => {
    const origin = mock(() => Response.json({ service_tier: 'default', choices: [{ message: { content: 'Do not accept this' } }] }));
    await expect(complete({ baseUrl: `${origin}/v1`, model: 'gpt-6-luna', apiKey: 'test', reasoningEffort: 'high', serviceTier: 'flex' }, 'Explain the supplied patch')).rejects.toThrow('did not confirm');
  });
  test('rejects invented source ranges and preserves unassigned changes', () => {
    const units = changeUnits(demoSession().review.files[0]);
    expect(() => validateRangeLayers({ summary: 'test', layers: [{ title: 'test', summary: 'test', ranges: [{ changeId: 'invented', start: 1, end: 1 }] }] }, units, 'test')).toThrow();
    expect(validateRangeLayers({ summary: 'test', layers: [] }, units, 'test').layers[0].files).toEqual([units[0].path]);
  });
  test('calls only the configured model and falls back when it returns bad JSON', async () => {
    let calls = 0;
    const origin = mock(async request => {
      expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
      expect(request.headers.get('authorization')).toBe('Bearer model-token');
      const body = await request.json() as any; expect(body.model).toBe('internal-model'); calls++;
      return Response.json({ choices: [{ message: { content: 'not json' } }] });
    });
    const result = await analyze(demoSession().review, { baseUrl: `${origin}/v1`, model: 'internal-model', apiKey: 'model-token' });
    expect(calls).toBe(1); expect(result.source).toBe('local'); expect(result.layers.flatMap(l => l.files)).toHaveLength(4); expect(result.warnings).toHaveLength(1);
  });
  test('local API requires a session and same-origin POST requests', async () => {
    const { server, url } = startServer(demoSession()); servers.push(server);
    const origin = server.url.origin;
    expect((await fetch(`${origin}/api/review`)).status).toBe(401);
    const secret = new URL(url).hash.slice('#session='.length);
    expect((await fetch(`${origin}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } })).status).toBe(403);
    const auth = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${secret}` } });
    expect(auth.status).toBe(200);
    const cookie = auth.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(`${origin}/api/review`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200); expect((await response.json() as any).demo).toBe(true);
    expect((await fetch(`${origin}/api/ask`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' } })).status).toBe(403);
    expect(makePatch('a.ts', 'a.ts', 'added', '@@ -0,0 +1 @@\n+x\n')).toContain('--- /dev/null');
  });
});


describe('Repository context budgets and explanation settings', () => {
  test('passes the custom prompt and Russian language with bounded input/output', async () => {
    const origin = mock(async request => {
      const body = await request.json() as any;
      expect(body.messages[0].content).toContain('Explain things simply.');
      expect(body.messages[0].content).toContain('Russian');
      expect(body.messages[1].content.length).toBe(8_000);
      expect(body.max_tokens).toBe(2_000);
      return Response.json({ choices: [{ message: { content: 'Ответ' } }] });
    });
    expect(await complete({ baseUrl: origin, model: 'test', apiKey: 'test', systemPrompt: 'Explain things simply.',
      language: 'ru', maxContextChars: 8_000, maxOutputTokens: 2_000 }, 'x'.repeat(10_000))).toBe('Ответ');
  });
  test('stops at the tool budget and forces a final summary', async () => {
    let modelCalls = 0, toolCalls = 0;
    const origin = mock(async request => {
      const body = await request.json() as any; modelCalls++;
      const final = body.messages[1].content.includes('Repository exploration has ended');
      return Response.json({ choices: [{ message: { content: JSON.stringify(final ? { summary: 'A short PR summary.', requests: [{ tool: 'read_file', path: 'never.ts' }] }
        : { requests: Array.from({ length: 20 }, () => ({ tool: 'list_files', path: '' })) }) } }] });
    });
    const summary = await summarizeRepository(demoSession().review, { baseUrl: origin, model: 'test', apiKey: 'test', maxToolCalls: 2 },
      demoSession().analysis.layers, async () => { toolCalls++; return { entries: [] }; });
    expect(summary).toBe('A short PR summary.'); expect(toolCalls).toBe(2); expect(modelCalls).toBe(2);
  });
  test('allows no more than two exploration rounds and still summarizes a bad plan', async () => {
    let modelCalls = 0, toolCalls = 0;
    const origin = mock(async request => {
      const body = await request.json() as any; modelCalls++;
      return Response.json({ choices: [{ message: { content: body.messages[1].content.includes('Repository exploration has ended')
        ? '{"summary":"Done."}' : '{"requests":[{"tool":"list_files","path":""}]}' } }] });
    });
    await summarizeRepository(demoSession().review, { baseUrl: origin, model: 'test', apiKey: 'test' }, [], async () => { toolCalls++; return {}; });
    expect(modelCalls).toBe(3); expect(toolCalls).toBe(2);
    const bad = mock(async request => Response.json({ choices: [{ message: { content: (await request.json() as any).messages[1].content.includes('Repository exploration has ended') ? '{"summary":"Still summarized."}' : 'invalid' } }] }));
    expect(await summarizeRepository(demoSession().review, { baseUrl: bad, model: 'test', apiKey: 'test' }, [], async () => { throw new Error('should not read'); })).toBe('Still summarized.');
  });
  test('reads a fork at its pinned SHA, rejects traversal, and bounds large responses', async () => {
    let requests = 0;
    const origin = mock(request => {
      requests++;
      const url = new URL(request.url);
      expect(url.pathname).toBe('/api/v3/repos/contributor/fork/contents/src/a.ts');
      expect(url.searchParams.get('ref')).toBe('pinned');
      return Response.json({ encoding: 'base64', content: Buffer.from('code').toString('base64') });
    });
    const review = { ...demoSession().review, target: parseTarget(`${origin}/owner/repo/pull/1`), repository: 'contributor/fork', headSha: 'pinned' };
    const read = repositoryReader(review, { provider: 'github', baseUrl: origin, token: 'test' });
    expect(await read({ tool: 'read_file', path: 'src/a.ts' })).toEqual({ path: 'src/a.ts', content: 'code', truncated: false });
    await expect(read({ tool: 'read_file', path: '../a' })).rejects.toThrow('Invalid');
    expect(requests).toBe(1);
    const large = mock(() => new Response('x'.repeat(600_000)));
    await expect(repositoryReader({ ...review, target: parseTarget(`${large}/owner/repo/pull/1`) }, { provider: 'github', baseUrl: large, token: 'test' })({ tool: 'list_files', path: '' })).rejects.toThrow('budget');
  });
  test('uses GitLab source project and read-only tree/files APIs', async () => {
    const origin = mock(request => {
      const url = new URL(request.url);
      expect(request.method).toBe('GET'); expect(url.searchParams.get('ref')).toBe('head');
      expect(url.pathname).toContain('/api/v4/projects/42/repository/');
      return Response.json(url.pathname.endsWith('/tree') ? [{ path: 'src/a.ts', type: 'blob' }] : { encoding: 'base64', content: Buffer.from('text').toString('base64') });
    });
    const read = repositoryReader({ ...demoSession().review, target: parseTarget(`${origin}/team/repo/-/merge_requests/1`), repository: '42', headSha: 'head' }, { provider: 'gitlab', baseUrl: origin, token: 'test' });
    expect((await read({ tool: 'list_files', path: 'src' }) as any).entries[0].path).toBe('src/a.ts');
    expect((await read({ tool: 'read_file', path: 'src/a.ts' }) as any).content).toBe('text');
  });
});


describe('Coherent settings and default language', () => {
  test('stores the editable prompt separately and preserves edits when saving preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cstack-settings-'));
    const path = join(dir, 'config.json');
    try {
      await saveConfig({ version: 1, hosts: {}, defaultLanguage: 'ru', ai: { baseUrl: 'https://internal.test/v1', model: 'test', apiKey: 'test-key', systemPrompt: 'Use simple words.' } }, path);
      const stored = JSON.parse(await readFile(path, 'utf8'));
      expect(stored.ai.apiKey).toBe('test-key'); expect(stored.ai.systemPrompt).toBeUndefined(); expect(stored.defaultLanguage).toBe('ru');
      expect(await readFile(promptPath(path), 'utf8')).toContain('Use simple words.');
      await writeFile(promptPath(path), 'My edited prompt.');
      const loaded = await loadConfig(path); expect(loaded.ai?.systemPrompt).toBe('My edited prompt.'); expect(loaded.ai?.language).toBe('ru');
      loaded.defaultLanguage = 'en'; await saveConfig(loaded, path);
      expect((await loadConfig(path)).ai?.systemPrompt).toBe('My edited prompt.'); expect((await loadConfig(path)).ai?.language).toBe('en');
      expect((await stat(promptPath(path))).mode & 0o777).toBe(0o600);
    } finally { await rm(dir, { recursive: true }); }
  });
  test('default language can be saved without a PR or model credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cstack-language-'));
    const path = join(dir, 'config.json');
    try {
      const child = Bun.spawn([process.execPath, 'src/cli.ts', '--default-language', 'ru'], { env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'ignore', stderr: 'ignore' });
      expect(await child.exited).toBe(0); expect((await loadConfig(path)).defaultLanguage).toBe('ru');
      expect(await readFile(promptPath(path), 'utf8')).toContain('simple');
    } finally { await rm(dir, { recursive: true }); }
  });
});
