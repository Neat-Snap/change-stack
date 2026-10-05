import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { findDiffLine, findDiffRange, originDiffUrl } from '../src/core/changes';
import { addDiffAnchors, CommentError, makePatch, postComment } from '../src/core/providers';
import { parseTarget } from '../src/core/target';
import { demoSession } from '../src/core/demo';
import { startServer } from '../src/server';
import type { HostConfig, Provider, Review } from '../src/core/types';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

const path = 'src/app.ts';
const diff = '@@ -10,3 +10,4 @@\n a\n-b\n+B\n+C\n d\n';
function review(provider: Provider, origin = 'https://git.company'): Review {
  const url = provider === 'gitlab' ? `${origin}/team/project/-/merge_requests/7` : `${origin}/owner/repo/pull/7`;
  return addDiffAnchors({ target: parseTarget(url), title: 'T', description: '', author: 'a', sourceBranch: 's', targetBranch: 'main',
    headSha: 'head', baseSha: 'base', startSha: 'start', warnings: [],
    files: [{ path, oldPath: path, status: 'modified', patch: makePatch(path, path, 'modified', diff), additions: 2, deletions: 1, incomplete: false }] });
}
const sha1 = createHash('sha1').update(path).digest('hex'), sha256 = createHash('sha256').update(path).digest('hex');

describe('Diff lines and origin links', () => {
  test('maps a visible line to the service diff counters', () => {
    const file = review('gitlab').files[0]!;
    expect(findDiffLine(file, 11, 'current')).toEqual({ kind: '+', old: 12, current: 11 });
    expect(findDiffLine(file, 11, 'old')).toEqual({ kind: '-', old: 11, current: 11 });
    expect(findDiffLine(file, 13, 'current')).toEqual({ kind: ' ', old: 12, current: 13 });
    expect(findDiffLine(file, 40, 'current')).toBeUndefined();
  });
  test('builds GitLab and GitHub diff anchors', () => {
    const gitlab = review('gitlab'), github = review('github');
    expect(originDiffUrl(gitlab, gitlab.files[0]!, { side: 'current', start: 11, end: 11 })).toBe(`https://git.company/team/project/-/merge_requests/7/diffs#${sha1}_12_11`);
    expect(originDiffUrl(gitlab, gitlab.files[0]!, { side: 'current', start: 90, end: 90 })).toBe(`https://git.company/team/project/-/merge_requests/7/diffs#${sha1}`);
    expect(originDiffUrl(github, github.files[0]!, { side: 'current', start: 11, end: 12 })).toBe(`https://git.company/owner/repo/pull/7/files#diff-${sha256}R11-R12`);
    expect(originDiffUrl(github, github.files[0]!, { side: 'old', start: 11, end: 11 })).toBe(`https://git.company/owner/repo/pull/7/files#diff-${sha256}L11`);
  });
  test('orders cross-side endpoints by diff rows rather than line numbers', () => {
    const pr = review('github'), file = pr.files[0]!;
    file.patch = makePatch(path, path, 'modified', '@@ -50,3 +40,3 @@\n before\n-old\n+new\n after\n');
    const range = { side: 'current' as const, start: 41, end: 51, endSide: 'old' as const };
    expect(findDiffRange(file, range)).toMatchObject({ range: { side: 'old', start: 51, end: 41, endSide: 'current' }, first: { kind: '-' }, last: { kind: '+' }, sameHunk: true });
    expect(originDiffUrl(pr, file, range)).toEndWith(`#diff-${sha256}L51-R41`);
  });
  test('keeps zero absent-side counters for new and deleted files', () => {
    const file = review('gitlab').files[0]!;
    file.patch = makePatch(path, path, 'added', '@@ -0,0 +1,2 @@\n+one\n+two\n');
    expect(findDiffLine(file, 2, 'current')).toEqual({ kind: '+', old: 0, current: 2 });
    expect(findDiffLine(file, 1, 'old')).toBeUndefined();
    file.patch = makePatch(path, path, 'deleted', '@@ -1,2 +0,0 @@\n-one\n-two\n');
    expect(findDiffLine(file, 2, 'old')).toEqual({ kind: '-', old: 2, current: 0 });
  });
});

describe('Posting comments', () => {
  function service(status = 201) {
    const requests: { path: string; body: any; auth: string | null }[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      requests.push({ path: new URL(request.url).pathname, body: await request.json(), auth: request.headers.get('private-token') ?? request.headers.get('authorization') });
      if (status !== 201) return Response.json({ message: 'nope' }, { status });
      return Response.json(new URL(request.url).pathname.includes('/discussions') ? { notes: [{ id: 99 }] } : { html_url: 'https://example/comment/1' }, { status });
    } });
    servers.push(server);
    return { origin: server.url.origin, requests };
  }
  test('anchors GitHub single and multi-line comments to diff sides', async () => {
    const { origin, requests } = service(), host: HostConfig = { provider: 'github', baseUrl: origin, token: 't' }, pr = review('github', origin);
    expect(await postComment(pr, host, { path, side: 'old', start: 11, end: 11, body: 'why?' })).toEqual({ url: 'https://example/comment/1' });
    await postComment(pr, host, { path, side: 'current', start: 13, end: 11, body: 'range' });
    expect(requests[0]!.path).toBe('/api/v3/repos/owner/repo/pulls/7/comments');
    expect(requests[0]!.body).toEqual({ body: 'why?', commit_id: 'head', path, line: 11, side: 'LEFT' });
    expect(requests[1]!.body).toMatchObject({ line: 13, side: 'RIGHT', start_line: 11, start_side: 'RIGHT' });
  });
  test('sends GitLab positions with line codes for ranges', async () => {
    const { origin, requests } = service(), host: HostConfig = { provider: 'gitlab', baseUrl: origin, token: 't' }, mr = review('gitlab', origin);
    expect(await postComment(mr, host, { path, side: 'current', start: 11, end: 11, body: 'one' })).toEqual({ url: `${mr.target.url}#note_99` });
    await postComment(mr, host, { path, side: 'current', start: 11, end: 13, body: 'range' });
    expect(requests[0]!.path).toBe('/api/v4/projects/team%2Fproject/merge_requests/7/discussions');
    expect(requests[0]!.body.position).toEqual({ position_type: 'text', base_sha: 'base', start_sha: 'start', head_sha: 'head', old_path: path, new_path: path, new_line: 11 });
    expect(requests[1]!.body.position).toMatchObject({ old_line: 12, new_line: 13, line_range: {
      start: { line_code: `${sha1}_12_11`, type: 'new', new_line: 11 }, end: { line_code: `${sha1}_12_13`, type: 'old', old_line: 12, new_line: 13 } } });
  });
  test('posts reversed cross-side ranges and converts old-side context to GitHub RIGHT', async () => {
    const { origin, requests } = service(), host: HostConfig = { provider: 'github', baseUrl: origin, token: 't' }, pr = review('github', origin);
    pr.files[0]!.patch = makePatch(path, path, 'modified', '@@ -50,3 +40,3 @@\n before\n-old\n+new\n after\n');
    await postComment(pr, host, { path, side: 'current', start: 41, end: 51, endSide: 'old', body: 'both' });
    expect(requests[0]!.body).toMatchObject({ start_line: 51, start_side: 'LEFT', line: 41, side: 'RIGHT' });
    await postComment(pr, host, { path, side: 'old', start: 52, end: 52, body: 'context' });
    expect(requests[1]!.body).toEqual({ body: 'context', commit_id: 'head', path, line: 42, side: 'RIGHT' });
  });
  test('rejects comments across hunks while retaining a link to the selection', async () => {
    const { origin, requests } = service(), host: HostConfig = { provider: 'github', baseUrl: origin, token: 't' }, pr = review('github', origin);
    const file = pr.files[0]!;
    file.patch += '@@ -40 +41 @@\n-later\n+Later\n';
    const range = { side: 'current' as const, start: 11, end: 41 };
    expect(findDiffRange(file, range)?.sameHunk).toBe(false);
    expect(originDiffUrl(pr, file, range)).toEndWith(`#diff-${sha256}R11-R41`);
    await expect(postComment(pr, host, { path, ...range, body: 'x' })).rejects.toThrow('one hunk');
    expect(requests).toHaveLength(0);
  });
  test('explains read-only tokens and lines outside the diff', async () => {
    const { origin, requests } = service(403), host: HostConfig = { provider: 'gitlab', baseUrl: origin, token: 't' }, mr = review('gitlab', origin);
    await expect(postComment(mr, host, { path, side: 'current', start: 11, end: 11, body: 'x' })).rejects.toThrow('api scope');
    await expect(postComment(mr, host, { path, side: 'current', start: 40, end: 40, body: 'x' })).rejects.toBeInstanceOf(CommentError);
    expect(requests).toHaveLength(1);
  });
});

test('comment endpoint validates input and allows one simultaneous post', async () => {
  const calls: unknown[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { server, url } = startServer(demoSession(), undefined, 0, undefined, '127.0.0.1', undefined, async input => {
    calls.push(input); await pending; return { url: 'https://example/comment' };
  });
  servers.push(server);
  const origin = server.url.origin, secret = new URL(url).hash.slice('#session='.length);
  const auth = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${secret}` } });
  const headers = { Origin: origin, Cookie: auth.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json' };
  const post = (body: string) => fetch(`${origin}/api/comment`, { method: 'POST', headers, body });
  expect((await post('null')).status).toBe(400);
  expect((await post('{')).status).toBe(400);
  const input = JSON.stringify({ path: demoSession().review.files[0]!.path, side: 'current', start: 1, end: 1, body: 'comment' });
  const responses = Promise.all([post(input), post(input)]);
  try {
    await Bun.sleep(30);
    expect(calls).toHaveLength(1);
  } finally { release(); }
  expect((await responses).map(response => response.status).sort()).toEqual([200, 429]);
});

test('malformed provider responses report an uncertain post rather than invalid input', async () => {
  const { server, url } = startServer(demoSession(), undefined, 0, undefined, '127.0.0.1', undefined, async () => {
    throw new SyntaxError('Malformed service response');
  });
  servers.push(server);
  const origin = server.url.origin, secret = new URL(url).hash.slice('#session='.length);
  const auth = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${secret}` } });
  const response = await fetch(`${origin}/api/comment`, { method: 'POST', headers: { Origin: origin, Cookie: auth.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: demoSession().review.files[0]!.path, side: 'current', start: 1, end: 1, body: 'comment' }) });
  expect(response.status).toBe(502);
  expect((await response.json() as any).error).toContain('Check the original diff');
});
