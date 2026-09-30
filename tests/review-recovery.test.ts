import { afterEach, expect, test } from 'bun:test';
import { applyPatch } from 'diff';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { saveConfig } from '../src/core/config';
import { completePatch, countChanges } from '../src/core/patches';
import { fetchReview } from '../src/core/providers';
import { parseTarget } from '../src/core/target';

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const serve = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch }); servers.push(server); return server.url.origin;
};
const blob = (text: string | Uint8Array) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const entry = (path: string, text: string | Uint8Array, mode = '100644') => ({ path, type: 'blob', id: blob(text), sha: blob(text), mode });
const mr = { title: 'Fixture', description: '', author: { username: 'fixture' }, source_branch: 'feature', target_branch: 'main',
  source_project_id: 42, target_project_id: 41, changes_count: '1', diff_refs: { head_sha: 'head', base_sha: 'base', start_sha: 'target' } };
const gitlabHost = (origin: string) => ({ provider: 'gitlab' as const, baseUrl: origin, token: 'fixture-token' });

const separator = Array.from({ length: 12 }, (_, i) => `unchanged ${i}`).join('\n');
const fixtures = [
  { path: 'src/whole.ts', oldPath: 'src/whole.ts', old: `old first\n${separator}\nold last\n`, current: `new first\n${separator}\nnew last\n`,
    diff: '@@ -1,2 +1,2 @@\n-old first\n+new first\n unchanged 0\n' },
  { path: 'src/added.ts', oldPath: 'src/added.ts', current: 'added\n', old: undefined, new_file: true, diff: '', too_large: true },
  { path: 'src/deleted.ts', oldPath: 'src/deleted.ts', old: 'deleted\n', current: undefined, deleted_file: true, diff: '', collapsed: true },
  { path: 'src/renamed.ts', oldPath: 'src/previous.ts', old: 'same\n', current: 'same\n', renamed_file: true, diff: '' },
  { path: 'src/markers.ts', oldPath: 'src/markers.ts', old: '\uFEFF++old\n--old', current: '\uFEFF++new\n--new', diff: '' },
  { path: 'src/empty.ts', oldPath: 'src/empty.ts', old: undefined, current: '', new_file: true, diff: '' },
  { path: 'src/mode.ts', oldPath: 'src/mode.ts', old: 'same\n', current: 'same\n', diff: '' },
  { path: 'src/link', oldPath: 'src/link', old: 'target-old.ts', current: 'target-new.ts', diff: '' },
];

test('verifies every diff, restores hidden hunks and files, and reads forks at exact pinned commits', async () => {
  const reads: { sha: string; project: string }[] = [];
  const origin = serve(request => {
    expect(request.headers.get('PRIVATE-TOKEN')).toBe('fixture-token');
    const url = new URL(request.url);
    if (url.pathname.endsWith('/diffs')) return Response.json(fixtures.slice(0, -1).map(f => ({ ...f, old_path: f.oldPath, new_path: f.path })));
    if (url.pathname.endsWith('/tree')) {
      const old = url.searchParams.get('ref') === 'base';
      expect(url.pathname).toContain(old ? '/projects/41/' : '/projects/42/');
      return Response.json(fixtures.filter(f => (old ? f.old : f.current) !== undefined)
        .map(f => entry(old ? f.oldPath : f.path, (old ? f.old : f.current)!, f.path.endsWith('/link') ? '120000' : !old && f.path.endsWith('mode.ts') ? '100755' : '100644')));
    }
    if (url.pathname.endsWith('/raw')) {
      const sha = url.pathname.split('/blobs/')[1]!.slice(0, -4);
      const project = url.pathname.split('/projects/')[1]!.split('/')[0]!;
      reads.push({ sha, project });
      const old = project === '41';
      const f = fixtures.find(f => (old ? f.old : f.current) !== undefined && blob((old ? f.old : f.current)!) === sha)!;
      const text = old ? f.old : f.current;
      expect(text).toBeDefined();
      return new Response(text);
    }
    return Response.json(mr);
  });
  const progress: string[] = [];
  const review = await fetchReview(parseTarget(`${origin}/team/project/-/merge_requests/1`), gitlabHost(origin), message => progress.push(message));
  // The metadata claims just one change, but the trees expose the complete file list.
  expect(review.files).toHaveLength(fixtures.length);
  expect(review.files.every(f => !f.incomplete)).toBe(true);
  for (const f of fixtures) {
    const restored = review.files.find(file => file.path === f.path)!;
    expect(restored).toBeDefined();
    if (f.old !== f.current) expect(applyPatch(f.old ?? '', restored.patch)).toBe(f.current ?? '');
    else { expect(restored.patch).toBe(''); expect(restored.diffNote).toContain('No text changes'); }
  }
  expect(review.files[0]!.patch).toContain('+new last');
  expect(review.files.find(f => f.path.endsWith('markers.ts'))!.patch).toContain('\uFEFF');
  expect(reads.some(r => r.sha === blob('added\n') && r.project === '41')).toBe(false);
  expect(reads.some(r => r.sha === blob('deleted\n') && r.project === '42')).toBe(false);
  expect(progress.at(-1)).toContain(`${fixtures.length}/${fixtures.length}`);
});

test('submodule commit changes remain in the diff without reading a directory as text', async () => {
  let reads = 0;
  const origin = serve(request => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/diffs')) return Response.json([]);
    if (url.pathname.endsWith('/tree')) return Response.json([{ path: 'vendor/module', type: 'commit', mode: '160000', id: url.searchParams.get('ref') === 'base' ? '1'.repeat(40) : '2'.repeat(40) }]);
    if (url.pathname.endsWith('/raw')) { reads++; return new Response('unexpected'); }
    return Response.json(mr);
  });
  const review = await fetchReview(parseTarget(`${origin}/team/project/-/merge_requests/1`), gitlabHost(origin));
  expect(reads).toBe(0); expect(review.files).toHaveLength(1);
  expect(review.files[0]!.patch).toContain(`-Subproject commit ${'1'.repeat(40)}`);
  expect(review.files[0]!.patch).toContain(`+Subproject commit ${'2'.repeat(40)}`);
  expect(review.files[0]!.incomplete).toBe(false);
});

test('counts header-like code lines and detects a truncated hunk without rejecting EOF markers', () => {
  const patch = '@@ -1,2 +1,2 @@\n---old\n+++new\n context\n\\ No newline at end of file\n';
  expect(countChanges(patch)).toEqual({ additions: 1, deletions: 1 });
  expect(completePatch(patch)).toBe(true);
  expect(completePatch('@@ -1,2 +1,2 @@\n-old\n+new\n')).toBe(false);
});

test('a capped GitHub tree is traversed without using its truncated recursive list', async () => {
  const calls: string[] = [];
  const origin = serve(request => {
    const url = new URL(request.url); calls.push(url.pathname + url.search);
    if (url.pathname.includes('/compare/')) return Response.json({ merge_base_commit: { sha: 'base' } });
    if (url.pathname.endsWith('/files')) return Response.json([]);
    if (url.pathname.includes('/git/trees/')) {
      if (url.searchParams.has('recursive')) return Response.json({ truncated: true, tree: [entry('wrong.ts', 'wrong')] });
      if (url.pathname.endsWith('/base') || url.pathname.endsWith('/head')) return Response.json({ truncated: false,
        tree: [{ type: 'tree', path: 'src', sha: url.pathname.endsWith('/base') ? 'old-tree' : 'new-tree' }] });
      return Response.json({ truncated: false, tree: [entry('file.ts', url.pathname.endsWith('/old-tree') ? 'old\n' : 'new\n')] });
    }
    if (url.pathname.includes('/git/blobs/')) return new Response(url.pathname.endsWith(blob('old\n')) ? 'old\n' : 'new\n');
    return Response.json({ title: 'Fixture', user: { login: 'fixture' }, changed_files: 1,
      head: { sha: 'head', ref: 'feature', repo: { full_name: 'fork/repo' } }, base: { sha: 'target', ref: 'main', repo: { full_name: 'owner/repo' } } });
  });
  const review = await fetchReview(parseTarget(`${origin}/owner/repo/pull/1`, 'github'), { provider: 'github', baseUrl: origin, token: 'fixture-token' });
  expect(review.files.map(f => f.path)).toEqual(['src/file.ts']);
  expect(review.files[0]!.patch).toContain('+new');
  expect(calls.some(c => c.includes('/fork/repo/git/trees/head'))).toBe(true);
  expect(calls.some(c => c.includes(`/owner/repo/git/blobs/${blob('old\n')}`))).toBe(true);
  expect(calls.some(c => c.includes(`/fork/repo/git/blobs/${blob('new\n')}`))).toBe(true);
});

test('recovers a GitHub review exceeding the 3,000-file endpoint cap', async () => {
  const paths = Array.from({ length: 3001 }, (_, i) => `src/file-${i}.ts`);
  const origin = serve(request => {
    const url = new URL(request.url);
    if (url.pathname.includes('/compare/')) return Response.json({ merge_base_commit: { sha: 'base' } });
    if (url.pathname.endsWith('/files')) {
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      return Response.json(paths.slice(start, Math.min(start + 100, 3000)).map(filename => ({ filename, status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+new\n' })));
    }
    if (url.pathname.includes('/git/trees/')) return Response.json({ truncated: false, tree: url.pathname.endsWith('/base') ? [] : paths.map(path => entry(path, 'new\n')) });
    if (url.pathname.includes('/git/blobs/')) return new Response('new\n');
    return Response.json({ title: 'Fixture', user: { login: 'fixture' }, changed_files: 3001, head: { sha: 'head', ref: 'feature' }, base: { sha: 'target', ref: 'main' } });
  });
  const review = await fetchReview(parseTarget(`${origin}/owner/repo/pull/1`, 'github'), { provider: 'github', baseUrl: origin, token: 'fixture-token' });
  expect(review.files).toHaveLength(3001);
  expect(review.files.every(f => !f.incomplete && f.patch.includes('+new'))).toBe(true);
  expect(review.warnings).toEqual([]);
});

function failingReview(failure: 'permission' | 'permission-valid' | 'encoding' | 'binary' | 'binary-truncated-head' | 'tree' | 'base' | 'large' | 'truncated', onModel?: () => void) {
  const data = failure === 'encoding' ? new Uint8Array([0xff]) : failure.startsWith('binary') ? 'binary\0bytes' : failure === 'large' ? 'x'.repeat(16 * 1024 * 1024 + 1) : 'old\n';
  return serve(request => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/chat/completions')) { onModel?.(); return Response.json({}); }
    if (url.pathname.endsWith('/diffs')) return Response.json([{ old_path: 'src/file.ts', new_path: 'src/file.ts', diff: failure === 'permission-valid' ? '@@ -1 +1 @@\n-old\n+new\n' : '', too_large: failure !== 'permission-valid' }]);
    if (url.pathname.endsWith('/tree')) return failure === 'tree' ? Response.json({ error: 'private-response' }) : Response.json([entry('src/file.ts', data)]);
    if (url.pathname.endsWith('/raw')) {
      if (failure.startsWith('permission')) return Response.json({ secret: 'private-response' }, { status: 403 });
      if (failure === 'encoding') return new Response(new Uint8Array([0xff]));
      if (failure.startsWith('binary')) return new Response(failure === 'binary-truncated-head' && url.pathname.includes('/projects/42/') ? 'cut' : 'binary\0bytes');
      if (failure === 'large') return new Response('x'.repeat(16 * 1024 * 1024 + 1));
      if (failure === 'truncated') return new Response('ol');
    }
    return Response.json(failure === 'base' ? { ...mr, diff_refs: { head_sha: 'head' } } : mr);
  });
}

test('unreadable text, unsupported encoding, missing bases, and incomplete trees stop preparation', async () => {
  for (const failure of ['permission', 'permission-valid', 'encoding', 'tree', 'base', 'large', 'truncated', 'binary-truncated-head'] as const) {
    const origin = failingReview(failure);
    try {
      await fetchReview(parseTarget(`${origin}/team/project/-/merge_requests/1`), gitlabHost(origin));
      throw new Error('An incomplete review was accepted.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toContain('private-response'); expect(message).not.toContain('fixture-token');
      expect(message).not.toBe('An incomplete review was accepted.');
      if (['permission', 'permission-valid', 'encoding', 'large', 'truncated', 'binary-truncated-head'].includes(failure)) {
        expect(message).toContain('src/file.ts'); expect(message).toContain('Review preparation stopped');
      }
    }
  }
});

test('binary files stay listed with a specific explanation instead of a missing-text warning', async () => {
  const origin = failingReview('binary');
  const review = await fetchReview(parseTarget(`${origin}/team/project/-/merge_requests/1`), gitlabHost(origin));
  expect(review.files).toHaveLength(1); expect(review.files[0]!.incomplete).toBe(false);
  expect(review.files[0]!.diffNote).toBe('Binary content has no textual diff.');
  expect(review.warnings).toEqual(['src/file.ts: Binary content has no textual diff.']);
});

test('CLI exits with the affected file and starts neither model calls nor a partial review', async () => {
  let modelCalls = 0;
  const origin = failingReview('permission-valid', () => modelCalls++);
  const directory = await mkdtemp(join(tmpdir(), 'cstack-complete-review-'));
  try {
    const path = join(directory, 'config.json');
    await saveConfig({ version: 1, hosts: { [origin]: gitlabHost(origin) },
      ai: { baseUrl: origin, model: 'fixture-model', apiKey: 'fixture-key' } }, path);
    const child = Bun.spawn([process.execPath, 'src/cli.ts', `${origin}/team/project/-/merge_requests/1`, '--no-open'],
      { env: { ...process.env, CHANGE_STACK_CONFIG: path }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const output = stdout + stderr;
    expect(exit).toBe(1); expect(output).toContain('src/file.ts'); expect(output).toContain('HTTP 403');
    expect(output).not.toContain('Review ready'); expect(output).not.toContain('Preparing review layers');
    expect(output).not.toContain('fixture-token'); expect(output).not.toContain('private-response');
    expect(modelCalls).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
