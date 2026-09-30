import { afterEach, expect, test } from 'bun:test';
import { RepositoryReadError } from '../src/core/repository';
import { reviewTools } from '../src/core/review-tools';
import { demoSession } from '../src/core/demo';
import { parseTarget } from '../src/core/target';
import { startServer } from '../src/server';
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

test('context reads rename old path from the base repository and current path from a pinned fork', async () => {
  const requests: string[] = [];
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer private-token');
    const url = new URL(request.url); requests.push(url.pathname + url.search);
    expect(request.headers.get('accept')).toBe('application/vnd.github.raw+json');
    return new Response(url.searchParams.get('ref') === 'base' ? 'old text' : 'new text');
  } }); servers.push(host);
  const review = { ...demoSession().review, target: parseTarget(`${host.url.origin}/owner/repo/pull/1`),
    repository: 'contributor/fork', baseRepository: 'owner/repo', headSha: 'head', baseSha: 'base',
    files: [{ ...demoSession().review.files[0], path: 'new.ts', oldPath: 'old.ts', status: 'renamed' as const }] };
  const tools = reviewTools(review, { baseUrl: host.url.origin, provider: 'github', token: 'private-token' });
  expect(await tools.context('new.ts')).toEqual({ old: 'old text', current: 'new text' });
  expect(requests).toContain('/api/v3/repos/owner/repo/contents/old.ts?ref=base');
  expect(requests).toContain('/api/v3/repos/contributor/fork/contents/new.ts?ref=head');
  await tools.context('new.ts'); expect(requests).toHaveLength(2);
  await expect(tools.context('../secret')).rejects.toThrow(); expect(requests).toHaveLength(2);
});

test('symbol lookup finds nearby definitions, reports scope, and rejects invalid identifiers', async () => {
  let calls = 0;
  const host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    calls++; const url = new URL(request.url); expect(url.searchParams.get('ref')).toBe('pinned');
    if (url.pathname.endsWith('/contents/src') || url.pathname.endsWith('/contents')) return Response.json([{ path: 'src/helper.ts', type: 'file' }]);
    return Response.json({ encoding: 'base64', content: Buffer.from(url.pathname.endsWith('helper.ts') ? 'export function acceptInvitation() {\n  return true;\n}' : 'acceptInvitation();').toString('base64') });
  } }); servers.push(host);
  const session = demoSession();
  const review = { ...session.review, target: parseTarget(`${host.url.origin}/owner/repo/pull/1`), repository: 'owner/repo', headSha: 'pinned',
    files: [{ ...session.review.files[0], path: 'src/caller.ts' }] };
  const tools = reviewTools(review, { baseUrl: host.url.origin, provider: 'github', token: 'test' });
  const result = await tools.lookup('acceptInvitation', 'src/caller.ts');
  expect(result.matches[0].kind).toBe('definition'); expect(result.matches[0].path).toBe('src/helper.ts'); expect(result.matches[0].line).toBe(1);
  expect(result.scanned).toBe(2); expect(result.unavailable).toBe(0);
  const before = calls; await expect(tools.lookup('.*', 'src/caller.ts')).rejects.toThrow(); expect(calls).toBe(before);
});

test('lookup API enforces session/origin and returns sanitized failures', async () => {
  const session = demoSession();
  let sizeFailure = false;
  const tools = { context: async () => { if (sizeFailure) throw new RepositoryReadError('This file is too large to load surrounding code. Its diff is still available.'); throw new Error('secret upstream response'); }, lookup: async () => ({ symbol: 'token', matches: [], scanned: 0, unavailable: 0, limited: false }) };
  const { server, url } = startServer(session, undefined, 0, undefined, '127.0.0.1', tools); servers.push(server);
  const origin = server.url.origin;
  const auth = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${new URL(url).hash.slice(9)}` } });
  const cookie = auth.headers.get('set-cookie')!.split(';')[0];
  const init = { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: session.review.files[0].path }) };
  expect((await fetch(`${origin}/api/context`, { ...init, headers: { Origin: origin } })).status).toBe(401);
  expect((await fetch(`${origin}/api/context`, { ...init, headers: { ...init.headers, Origin: 'https://outside.example' } })).status).toBe(403);
  const response = await fetch(`${origin}/api/context`, init); expect(response.status).toBe(422); expect(await response.text()).not.toContain('secret');
  sizeFailure = true;
  expect((await (await fetch(`${origin}/api/context`, init)).json()).error).toBe('This file is too large to load surrounding code. Its diff is still available.');
  expect((await fetch(`${origin}/api/context`, { headers: { Cookie: cookie } })).status).toBe(405);
});


test('context accepts larger raw text while enforcing a bounded read on both providers', async () => {
  for (const provider of ['github', 'gitlab'] as const) {
    let tooLarge = false;
    const host = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url);
      expect(['base', 'head']).toContain(url.searchParams.get('ref')!);
      if (provider === 'gitlab') {
        expect(url.pathname.endsWith('/files/src%2Fcaller.ts/raw')).toBe(true);
        expect(request.headers.get('private-token')).toBe('private-token');
      } else expect(request.headers.get('accept')).toBe('application/vnd.github.raw+json');
      return new Response('x'.repeat(tooLarge ? 2_000_001 : 600_000));
    } }); servers.push(host);
    const session = demoSession();
    const review = { ...session.review, target: parseTarget(`${host.url.origin}/owner/repo/${provider === 'gitlab' ? '-/merge_requests' : 'pull'}/1`, provider),
      repository: 'owner/repo', headSha: 'head', baseSha: 'base',
      files: [{ ...session.review.files[0], path: 'src/caller.ts', oldPath: 'src/caller.ts', status: 'modified' as const }] };
    const config = { baseUrl: host.url.origin, provider, token: 'private-token' };
    const source = await reviewTools(review, config).context('src/caller.ts');
    expect(source.old.length).toBe(600_000); expect(source.current.length).toBe(600_000);
    tooLarge = true;
    await expect(reviewTools(review, config).context('src/caller.ts')).rejects.toThrow('This file is too large to load surrounding code. Its diff is still available.');
  }
});
