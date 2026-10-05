import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { changeUnits } from '../src/core/changes';
import { makePatch } from '../src/core/providers';
import type { ChangedFile } from '../src/core/types';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const head = 'a'.repeat(40);
const diff = '@@ -0,0 +1,24 @@\n' + Array.from({ length: 24 }, (_, i) => `+int value${i} = ${i};`).join('\n') + '\n';
const file: ChangedFile = { path: 'src/Example.java', oldPath: 'src/Example.java', status: 'added', additions: 24, deletions: 0, incomplete: false,
  patch: makePatch('src/Example.java', 'src/Example.java', 'added', diff) };
const changeId = changeUnits(file)[0]!.id;
const source = Array.from({ length: 24 }, (_, i) => `int value${i} = ${i};`).join('\n') + '\n';
const blob = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0${source}`).digest('hex');

async function request(value: unknown, environment: Record<string, string | undefined> = {}) {
  const directory = await mkdtemp('/tmp/cstack-native-protocol-');
  try {
    const executable = process.env.CHANGE_STACK_IDE_EXECUTABLE;
    const child = Bun.spawn(executable ? [executable, '--ide-request'] : [process.execPath, 'src/cli.ts', '--ide-request'], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CHANGE_STACK_CONFIG: `${directory}/config.json`,
        CHANGE_STACK_CA_FILE: undefined, NODE_TLS_REJECT_UNAUTHORIZED: undefined, ...environment },
    });
    child.stdin.write(JSON.stringify(value)); child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout).not.toContain('native-git-secret'); expect(stdout).not.toContain('native-model-secret');
    expect(stderr).not.toContain('native-git-secret'); expect(stderr).not.toContain('native-model-secret');
    expect(stdout.trim().split('\n')).toHaveLength(1);
    return { value: JSON.parse(stdout), stderr, code };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('native IDE protocol fetches the matching MR, runs semantic analysis, and returns groups, dependencies, parts and source positions', async () => {
  let modelCalls = 0, gitCalls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/v1/chat/completions') {
      expect(request.headers.get('authorization')).toBe('Bearer native-model-secret'); modelCalls++;
      const prompt = (await request.json() as any).messages[1].content as string;
      let content;
      if (prompt.startsWith('Organize these numbered')) content = { summary: 'Adds values.', layers: [
        { title: 'Foundation', summary: 'Defines the first values.', ranges: [{ changeId, first: 1, last: 12 }] },
        { title: 'Behavior', summary: 'Defines more values.', ranges: [{ changeId, first: 13, last: 24 }] },
      ] };
      else if (prompt.startsWith('Arrange these review layers')) content = { order: ['batch-0-0', 'batch-0-1'], groups: [
        { title: 'Foundation area', layers: ['batch-0-0'] }, { title: 'Behavior area', layers: ['batch-0-1'] },
      ], dependencies: [{ layer: 'batch-0-1', dependsOn: ['batch-0-0'] }] };
      else if (prompt.startsWith('Break this review layer')) {
        const start = prompt.includes('Defines the first values.') ? 1 : 13;
        content = { parts: [{ title: 'First half', summary: 'Defines values.', ranges: [{ changeId, first: start, last: start + 5 }] },
          { title: 'Second half', summary: 'Completes values.', ranges: [{ changeId, first: start + 6, last: start + 11 }] }] };
      } else if (prompt.startsWith('Choose useful')) content = { requests: [] };
      else content = { summary: 'Adds two related sets of values.' };
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
    }
    expect(request.headers.get('private-token')).toBe('native-git-secret'); gitCalls++;
    if (url.pathname.endsWith('/diffs')) return Response.json([{ old_path: file.path, new_path: file.path, new_file: true, diff }]);
    if (url.pathname.endsWith('/tree')) return Response.json(url.searchParams.get('ref') === head ? [{ path: file.path, type: 'blob', mode: '100644', id: blob }] : []);
    if (url.pathname.endsWith('/raw')) return new Response(source);
    return Response.json({ title: 'Native Java review', description: 'Adds two groups of values.', author: { username: 'developer' },
      source_branch: 'feature', target_branch: 'main', source_project_id: 1, target_project_id: 1, changes_count: '1',
      diff_refs: { head_sha: head, base_sha: 'b'.repeat(40), start_sha: 'b'.repeat(40) } });
  } }); servers.push(server);
  const origin = server.url.origin;
  const result = await request({ version: 1, url: `${origin}/team/project/-/merge_requests/7`, expectedHeadSha: head,
    host: { provider: 'gitlab', baseUrl: origin, token: 'native-git-secret' }, ai: { baseUrl: `${origin}/v1`, model: 'fixture', apiKey: 'native-model-secret' } });
  expect(result.code).toBe(0); expect(result.value.ok).toBe(true);
  const snapshot = result.value.snapshot;
  expect(snapshot.review.headSha).toBe(head); expect(snapshot.analysis.source).toBe('model');
  expect(snapshot.analysis.groups).toHaveLength(2); expect(snapshot.analysis.layers[1].dependsOn).toEqual(['batch-0-0']);
  expect(snapshot.analysis.layers[0].parts).toHaveLength(2);
  expect(snapshot.analysis.layers[0].annotations[0]).toMatchObject({ path: file.path, side: 'current', start: 1, end: 6 });
  expect(JSON.stringify(snapshot)).not.toContain('+int value');
  expect(gitCalls).toBeGreaterThan(0); expect(modelCalls).toBeGreaterThan(3);
  expect(result.stderr).toContain('progress');
});

test('native IDE protocol rejects a changed head before sending code to the model', async () => {
  let modelCalls = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname.includes('/chat/')) modelCalls++;
    if (new URL(request.url).pathname.endsWith('/diffs') || new URL(request.url).pathname.endsWith('/tree')) return Response.json([]);
    return Response.json({ title: 'Changed', changes_count: '0', diff_refs: { head_sha: head, base_sha: 'b'.repeat(40) } });
  } }); servers.push(server);
  const origin = server.url.origin;
  const result = await request({ version: 1, url: `${origin}/team/project/-/merge_requests/7`, expectedHeadSha: 'c'.repeat(40),
    host: { provider: 'gitlab', baseUrl: origin, token: 'native-git-secret' }, ai: { baseUrl: `${origin}/v1`, model: 'fixture', apiKey: 'native-model-secret' } });
  expect(result.code).toBe(1); expect(result.value.error).toContain('merge request changed'); expect(modelCalls).toBe(0);
});

test('native IDE protocol reports malformed input without starting setup or exposing secrets', async () => {
  const result = await request({ version: 2, token: 'native-git-secret' });
  expect(result.code).toBe(1); expect(result.value).toEqual({ ok: false, error: 'Invalid IDE request.' });
});

test('IDE analyzer trusts a selected corporate CA for GitLab and the model, while rejecting untrusted TLS', async () => {
  const directory = await mkdtemp('/tmp/cstack-ide-tls-');
  try {
    const ca = join(directory, 'company.crt'), caKey = join(directory, 'ca.key');
    const cert = join(directory, 'server.pem'), key = join(directory, 'server.key'), csr = join(directory, 'server.csr');
    const caConfig = join(directory, 'ca.conf'), extension = join(directory, 'extensions.txt');
    await Bun.write(caConfig, '[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
    await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${caKey} -out ${ca} -days 1 -subj /CN=ChangeStackIdeCA -config ${caConfig}`.quiet();
    await Bun.$`openssl req -newkey rsa:2048 -nodes -keyout ${key} -out ${csr} -subj /CN=localhost`.quiet();
    await Bun.write(extension, 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n');
    await Bun.$`openssl x509 -req -in ${csr} -CA ${ca} -CAkey ${caKey} -CAcreateserial -out ${cert} -days 1 -extfile ${extension}`.quiet();
    let modelCalls = 0;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, tls: { cert: Bun.file(cert), key: Bun.file(key) }, async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/v1/chat/completions') {
        expect(req.headers.get('authorization')).toBe('Bearer native-model-secret'); modelCalls++;
        const prompt = (await req.json() as any).messages[1].content as string;
        const content = prompt.startsWith('Organize these numbered')
          ? { summary: 'Adds values.', layers: [{ title: 'Values', summary: 'Adds values.', ranges: [{ changeId, first: 1, last: 24 }] }] }
          : prompt.startsWith('Break this review layer') ? { parts: [] }
            : prompt.startsWith('Choose useful') ? { requests: [] } : { summary: 'Adds values.' };
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      }
      expect(req.headers.get('private-token')).toBe('native-git-secret');
      if (url.pathname.endsWith('/diffs')) return Response.json([{ old_path: file.path, new_path: file.path, new_file: true, diff }]);
      if (url.pathname.endsWith('/tree')) return Response.json(url.searchParams.get('ref') === head ? [{ path: file.path, type: 'blob', mode: '100644', id: blob }] : []);
      if (url.pathname.endsWith('/raw')) return new Response(source);
      return Response.json({ title: 'Corporate TLS review', changes_count: '1', diff_refs: { head_sha: head, base_sha: 'b'.repeat(40) } });
    } }); servers.push(server);
    const origin = `https://localhost:${server.port}`;
    const input = { version: 1, url: `${origin}/team/project/-/merge_requests/7`, expectedHeadSha: head,
      host: { provider: 'gitlab', baseUrl: origin, token: 'native-git-secret' }, ai: { baseUrl: `${origin}/v1`, model: 'fixture', apiKey: 'native-model-secret' } };
    for (const env of [{}, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
      const rejected = await request(input, env);
      expect(rejected.code).toBe(1); expect(rejected.value.error).toContain('TLS certificate verification failed');
      expect(rejected.value.error).toContain('Analysis settings'); expect(modelCalls).toBe(0);
    }
    const trusted = await request(input, { CHANGE_STACK_CA_FILE: ca });
    expect(trusted.code).toBe(0); expect(trusted.value.snapshot.analysis.source).toBe('model');
    expect(trusted.value.snapshot.analysis.layers[0].title).toBe('Values'); expect(modelCalls).toBeGreaterThan(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
