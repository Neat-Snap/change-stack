import { gitApiBase } from './target';
import { serviceJson } from './network';
import type { ChangedFile, HostConfig, Review, ReviewTarget } from './types';

export async function validateHost(host: HostConfig): Promise<void> {
  const api = gitApiBase(host);
  await serviceJson(`${api}/user`, new URL(api).origin, { headers: headers(host) });
}
function headers(host: HostConfig): Record<string, string> {
  return host.provider === 'gitlab' ? { 'PRIVATE-TOKEN': host.token }
    : { Authorization: `Bearer ${host.token}`, Accept: 'application/vnd.github+json' };
}
export function makePatch(oldPath: string, path: string, status: ChangedFile['status'], diff: string): string {
  if (!diff) return '';
  return `diff --git ${JSON.stringify(`a/${oldPath}`)} ${JSON.stringify(`b/${path}`)}\n--- ${status === 'added' ? '/dev/null' : JSON.stringify(`a/${oldPath}`)}\n+++ ${status === 'deleted' ? '/dev/null' : JSON.stringify(`b/${path}`)}\n${diff}${diff.endsWith('\n') ? '' : '\n'}`;
}
export function countChanges(diff: string): { additions: number; deletions: number } {
  const lines = diff.split('\n');
  return { additions: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
    deletions: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length };
}

export async function fetchReview(target: ReviewTarget, host: HostConfig): Promise<Review> {
  if (new URL(host.baseUrl).origin !== target.origin || host.provider !== target.provider) throw new Error('Credentials do not match this review host.');
  const api = gitApiBase(host);
  const get = <T>(path: string) => serviceJson<T>(`${api}${path}`, new URL(api).origin, { headers: headers(host) });
  const files: ChangedFile[] = [];
  const warnings: string[] = [];
  if (target.provider === 'gitlab') {
    const prefix = new URL(host.baseUrl).pathname.replace(/^\/|\/$/g, '');
    const project = prefix && target.project.startsWith(`${prefix}/`) ? target.project.slice(prefix.length + 1) : target.project;
    const path = `/projects/${encodeURIComponent(project)}/merge_requests/${target.number}`;
    const mr = await get<any>(path);
    if (!mr.diff_refs?.head_sha) throw new Error('GitLab has not prepared this merge request diff yet. Retry shortly.');
    let finished = false;
    for (let page = 1; page <= 100; page++) {
      const diffs = await get<any[]>(`${path}/diffs?per_page=100&page=${page}`);
      for (const d of diffs) {
        const status = d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified';
        const diff = d.diff ?? '';
        files.push({ path: d.new_path, oldPath: d.old_path, status, patch: makePatch(d.old_path, d.new_path, status, diff),
          ...countChanges(diff), incomplete: !!(d.too_large || d.collapsed || !diff) });
      }
      if (diffs.length < 100) { finished = true; break; }
    }
    if (!finished) warnings.push('File pagination limit reached; this review may be incomplete.');
    const count = Number.parseInt(mr.changes_count ?? '', 10);
    if (Number.isFinite(count) && count > files.length || String(mr.changes_count).endsWith('+')) warnings.push('GitLab reports additional or capped changes. Some files may be missing.');
    const current = await get<any>(path);
    if (current.diff_refs?.head_sha !== mr.diff_refs.head_sha || current.diff_refs?.base_sha !== mr.diff_refs.base_sha || current.diff_refs?.start_sha !== mr.diff_refs.start_sha) throw new Error('The merge request changed while loading. Run the command again for a consistent snapshot.');
    return { target, title: mr.title, description: mr.description ?? '', author: mr.author?.username ?? 'Unknown',
      sourceBranch: mr.source_branch, targetBranch: mr.target_branch, headSha: mr.diff_refs.head_sha, repository: String(mr.source_project_id ?? project), files, warnings };
  }
  const projectPath = target.project.split('/').map(encodeURIComponent).join('/');
  const path = `/repos/${projectPath}/pulls/${target.number}`;
  const pr = await get<any>(path);
  for (let page = 1; page <= 30; page++) {
    const changes = await get<any[]>(`${path}/files?per_page=100&page=${page}`);
    for (const d of changes) {
      const status = d.status === 'removed' ? 'deleted' : d.status === 'added' ? 'added' : d.status === 'renamed' ? 'renamed' : 'modified';
      files.push({ path: d.filename, oldPath: d.previous_filename ?? d.filename, status,
        patch: makePatch(d.previous_filename ?? d.filename, d.filename, status, d.patch ?? ''),
        additions: d.additions, deletions: d.deletions, incomplete: !d.patch || countChanges(d.patch).additions !== d.additions || countChanges(d.patch).deletions !== d.deletions });
    }
    if (changes.length < 100) break;
  }
  if (pr.changed_files > files.length) warnings.push('GitHub returned only part of this review (its files API is capped at 3,000 files).');
  const current = await get<any>(path);
  if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha) throw new Error('The pull request changed while loading. Run the command again for a consistent snapshot.');
  return { target, title: pr.title, description: pr.body ?? '', author: pr.user.login,
    sourceBranch: pr.head.ref, targetBranch: pr.base.ref, headSha: pr.head.sha, repository: pr.head.repo?.full_name ?? target.project, files, warnings };
}
