import { afterEach, expect, test } from 'bun:test';
import { conversationService, ConversationError, type ConversationService } from '../src/core/conversations';
import { demoSession } from '../src/core/demo';
import { parseTarget } from '../src/core/target';
import { startServer } from '../src/server';
import type { Conversation, Provider, ReviewThread } from '../src/core/types';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const timestamp = '2026-10-01T12:00:00Z';
const item: ReviewThread = { id: 'thread', kind: 'diff', resolved: false, resolvable: true, canResolve: true, canReply: true,
  comments: [{ id: 'note', author: 'alice', body: 'Question', createdAt: timestamp, url: 'https://example.test/note' }] };
function fixture(provider: Provider, handler: (request: Request) => Response | Promise<Response>, prefix = '') {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler }); servers.push(server);
  const origin = server.url.origin, baseUrl = origin + prefix, review = demoSession().review;
  review.target = parseTarget(provider === 'gitlab' ? `${baseUrl}/team/repo/-/merge_requests/7` : `${baseUrl}/owner/repo/pull/7`);
  review.headSha = 'head'; review.baseSha = 'base'; review.startSha = 'start'; review.targetSha = 'target';
  return { service: conversationService(review, { provider, baseUrl, token: 'test-token' }), review, origin };
}

test('GitLab loads paginated threaded notes, skips system events, preserves resolved and old-side positions', async () => {
  const writes: { path: string; method: string; body: any }[] = [];
  let changed = false;
  const { service } = fixture('gitlab', async request => {
    expect(request.headers.get('PRIVATE-TOKEN')).toBe('test-token');
    const url = new URL(request.url);
    if (request.method !== 'GET') { writes.push({ path: url.pathname, method: request.method, body: await request.json() }); return Response.json({}); }
    if (!url.pathname.endsWith('/discussions')) return Response.json({ diff_refs: { head_sha: changed ? 'new-head' : 'head', base_sha: 'base', start_sha: 'start' } });
    if (url.searchParams.get('page') === '1') return Response.json(Array.from({ length: 100 }, (_, id) => ({ id, notes: [{ system: true }] })));
    return Response.json([{ id: 'diff/thread', individual_note: false, notes: [
      { id: 1, body: 'Question', created_at: timestamp, author: { username: 'alice' }, resolvable: true, resolved: true, resolved_by: { username: 'bob' },
        position: { old_path: 'old.ts', new_path: 'new.ts', old_line: 12, new_line: null, head_sha: 'head', line_range: { start: { type: 'old', old_line: 10 } } } },
      { id: 2, body: 'Answer', created_at: timestamp, author: { username: 'bob' }, resolvable: true, resolved: true },
      { id: 3, system: true },
    ] }, { id: 'individual', individual_note: true, notes: [{ id: 4, body: 'Note', created_at: timestamp }] }]);
  }, '/install');
  const snapshot = await service.load(), thread = snapshot.threads[0]!;
  expect(snapshot.reviewChanged).toBe(false); expect(snapshot.threads).toHaveLength(2);
  expect(thread).toMatchObject({ resolved: true, resolvedBy: 'bob', outdated: false, position: { path: 'old.ts', line: 12, side: 'old', startLine: 10, startSide: 'old' } });
  expect(thread.comments).toHaveLength(2); expect(snapshot.threads[1]!.canReply).toBe(false);
  await service.reply(thread, 'Reply'); await service.resolve(thread, false); await service.comment('General');
  expect(writes).toEqual([
    { path: '/install/api/v4/projects/team%2Frepo/merge_requests/7/discussions/diff%2Fthread/notes', method: 'POST', body: { body: 'Reply' } },
    { path: '/install/api/v4/projects/team%2Frepo/merge_requests/7/discussions/diff%2Fthread', method: 'PUT', body: { resolved: false } },
    { path: '/install/api/v4/projects/team%2Frepo/merge_requests/7/discussions', method: 'POST', body: { body: 'General' } },
  ]);
  await expect(service.reply(snapshot.threads[1]!, 'No')).rejects.toThrow('original review');
  changed = true;
  expect((await service.load()).threads[0]!.outdated).toBe(true);
});

test('GitHub paginates threads and their replies, combines review bodies and discussions, and uses thread mutations', async () => {
  const calls: { path: string; body: any }[] = [];
  let changed = false;
  const note = (id: number) => ({ id: `note${id}`, databaseId: id, body: `Comment ${id}`, createdAt: timestamp, url: `https://example.test/${id}`, author: { login: 'alice' } });
  const node = (id: string) => ({ id, path: 'file.ts', line: 15, startLine: 13, diffSide: 'RIGHT', startDiffSide: 'LEFT', isResolved: id === 'resolved', isOutdated: false,
    viewerCanReply: true, viewerCanResolve: true, viewerCanUnresolve: false, resolvedBy: id === 'resolved' ? { login: 'bob' } : null,
    comments: { nodes: [note(42)], pageInfo: { hasNextPage: id === 'open', endCursor: 'comment-cursor' } } });
  const { service } = fixture('github', async request => {
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');
    const url = new URL(request.url);
    if (url.pathname === '/api/graphql') {
      const body = await request.json() as any; calls.push({ path: url.pathname, body });
      if (body.query.includes('mutation')) return Response.json({ data: { resolveReviewThread: { thread: { id: 'open', isResolved: true } } } });
      if (body.query.includes('ThreadComments')) { expect(body.variables).toEqual({ id: 'open', after: 'comment-cursor' }); return Response.json({ data: { node: { comments: { nodes: [note(43)], pageInfo: { hasNextPage: false } } } } }); }
      return Response.json({ data: { repository: { pullRequest: { headRefOid: changed ? 'new-head' : 'head', baseRefOid: 'target', reviewThreads: {
        nodes: [node(body.variables.after ? 'resolved' : 'open')], pageInfo: { hasNextPage: !body.variables.after, endCursor: 'thread-cursor' },
      } } } } });
    }
    if (request.method === 'POST') { calls.push({ path: url.pathname, body: await request.json() }); return Response.json({}); }
    if (url.pathname.endsWith('/reviews')) return Response.json([
      { id: 90, body: 'Looks good', state: 'APPROVED', submitted_at: timestamp, user: { login: 'bob' }, html_url: 'https://example.test/review' },
      { id: 91, body: 'Unsubmitted', state: 'PENDING' }, { id: 92, body: ' ', state: 'COMMENTED' },
    ]);
    return Response.json([{ id: 70, body: 'General note', created_at: timestamp, user: { login: 'carol' }, html_url: 'https://example.test/general' }]);
  });
  const snapshot = await service.load(), thread = snapshot.threads.find(thread => thread.id === 'open')!;
  expect(snapshot.threads).toHaveLength(4); expect(thread.comments).toHaveLength(2);
  expect(thread).toMatchObject({ replyId: 42, position: { side: 'current', line: 15, startSide: 'old', startLine: 13 }, outdated: false });
  expect(snapshot.threads.find(t => t.id === 'resolved')!.canResolve).toBe(false);
  expect(snapshot.threads.find(t => t.id === 'review:90')!.reviewState).toBe('APPROVED');
  await service.reply(thread, 'Answer'); await service.resolve(thread, true); await service.resolve(thread, false);
  await service.reply(snapshot.threads.find(t => t.id === 'issue:70')!, 'General reply'); await service.comment('New discussion');
  expect(calls.find(call => call.path.endsWith('/comments/42/replies'))!.body).toEqual({ body: 'Answer' });
  expect(calls.filter(call => call.body.query?.includes('mutation')).map(call => call.body.query)).toEqual([
    expect.stringContaining('resolveReviewThread(input'), expect.stringContaining('unresolveReviewThread(input'),
  ]);
  expect(calls.filter(call => call.path.endsWith('/issues/7/comments')).map(call => call.body.body)).toEqual(['General reply', 'New discussion']);
  changed = true; expect((await service.load()).reviewChanged).toBe(true);
  expect((await service.load()).threads.find(t => t.id === 'open')!.outdated).toBe(true);
});

test('provider errors are safe and credentials cannot cross review hosts', async () => {
  const { service, review } = fixture('gitlab', () => Response.json({ message: 'secret-proxy-details' }, { status: 403 }));
  await expect(service.load()).rejects.toThrow('HTTP 403');
  await expect(service.load()).rejects.not.toThrow('secret-proxy-details');
  expect(() => conversationService(review, { provider: 'gitlab', baseUrl: 'https://other.example', token: 'secret' })).toThrow('Credentials do not match');
  const github = fixture('github', () => Response.json({ errors: [{ message: 'sensitive-data' }] }));
  await expect(github.service.load()).rejects.toThrow('GitHub could not complete');
});

async function local(service: ConversationService) {
  const result = startServer(demoSession(), undefined, 0, undefined, '127.0.0.1', undefined, undefined, service); servers.push(result.server);
  const origin = result.server.url.origin;
  const auth = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${new URL(result.url).hash.slice('#session='.length)}` } });
  const headers = { Origin: origin, Cookie: auth.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json' };
  return { origin, get: () => fetch(`${origin}/api/conversation`, { headers }), post: (action: string, body: unknown) => fetch(`${origin}/api/conversation/${action}`, { method: 'POST', headers, body: JSON.stringify(body) }) };
}

test('local conversation API authenticates, validates and gates writes to fetched thread IDs', async () => {
  const writes: string[] = [], snapshot: Conversation = { threads: [item], reviewChanged: false, fetchedAt: timestamp };
  const api = await local({ load: async () => snapshot, reply: async thread => { writes.push(thread.id); }, resolve: async (_, value) => { writes.push(String(value)); }, comment: async body => { writes.push(body); } });
  expect((await fetch(`${api.origin}/api/conversation`)).status).toBe(401);
  expect((await api.post('reply', null)).status).toBe(400);
  expect((await api.post('resolve', { threadId: 'thread', resolved: 'true' })).status).toBe(400);
  expect((await api.post('comment', { body: ' ' })).status).toBe(400);
  expect((await api.post('comment', { body: 'a'.repeat(20_001) })).status).toBe(400);
  expect((await api.post('reply', { threadId: 'other-review-thread', body: 'No' })).status).toBe(404);
  expect(writes).toHaveLength(0);
  expect((await api.post('reply', { threadId: 'thread', body: 'Yes' })).status).toBe(200);
  expect((await api.post('resolve', { threadId: 'thread', resolved: true })).status).toBe(200);
  expect((await api.post('comment', { body: '🙂'.repeat(10_000) })).status).toBe(200);
  expect(writes.slice(0, 2)).toEqual(['thread', 'true']);
});

test('local API coalesces reads, serializes updates, and preserves confirmed writes when refresh fails', async () => {
  let loads = 0, writes = 0, fail = false, releaseRead!: () => void, releaseWrite!: () => void;
  const reading = new Promise<void>(resolve => { releaseRead = resolve; }), writing = new Promise<void>(resolve => { releaseWrite = resolve; });
  const api = await local({ async load() { loads++; await reading; if (fail) throw new ConversationError('Refresh failed safely'); return { threads: [item], reviewChanged: false, fetchedAt: timestamp }; },
    async reply() { writes++; await writing; }, async resolve() {}, async comment() {} });
  const reads = Promise.all([api.get(), api.get()]); await Bun.sleep(25);
  expect(loads).toBe(1); releaseRead(); expect((await reads).map(r => r.status)).toEqual([200, 200]);
  const posts = Promise.all([api.post('reply', { threadId: 'thread', body: 'One' }), api.post('reply', { threadId: 'thread', body: 'Two' })]);
  try { await Bun.sleep(25); expect(writes).toBe(1); fail = true; } finally { releaseWrite(); }
  expect((await posts).map(r => r.status).sort()).toEqual([200, 429]);
  expect((await api.get()).status).toBe(502);
});
