import { gitApiBase } from './target';
import { serviceJson } from './network';
import { completePatch, countChanges, makePatch } from './patches';
import { recoverFileList, recoverTextDiffs, ReviewRecoveryError } from './review-recovery';
import type { ChangedFile, HostConfig, Review, ReviewTarget } from './types';

export { countChanges, makePatch } from './patches';

export async function validateHost(host: HostConfig): Promise<void> {
  const api = gitApiBase(host);
  await serviceJson(`${api}/user`, new URL(api).origin, { headers: headers(host) });
}
function headers(host: HostConfig): Record<string, string> {
  return host.provider === 'gitlab' ? { 'PRIVATE-TOKEN': host.token }
    : { Authorization: `Bearer ${host.token}`, Accept: 'application/vnd.github+json' };
}
export async function fetchReview(target: ReviewTarget, host: HostConfig, onProgress?: (message: string) => void): Promise<Review> {
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
    if (!mr.diff_refs?.head_sha) throw new ReviewRecoveryError('GitLab has not prepared this merge request diff yet. Retry shortly.');
    for (let page = 1; page <= 100; page++) {
      const diffs = await get<any[]>(`${path}/diffs?per_page=100&page=${page}`);
      for (const d of diffs) {
        const status = d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified';
        const diff = d.diff ?? '';
        files.push({ path: d.new_path, oldPath: d.old_path, status, patch: makePatch(d.old_path, d.new_path, status, diff),
          ...countChanges(diff), incomplete: !!(d.too_large || d.collapsed || !completePatch(diff)),
          oldMode: d.a_mode, newMode: d.b_mode,
          ...(d.too_large ? { diffNote: 'The Git service omitted this diff because of its size limit.' }
            : d.collapsed ? { diffNote: 'The Git service collapsed this diff.' }
            : !completePatch(diff) ? { diffNote: 'The Git service returned an empty or truncated diff.' } : {}) });
      }
      if (diffs.length < 100) break;
    }
    const count = Number.parseInt(mr.changes_count ?? '', 10);
    const review: Review = { target, title: mr.title, description: mr.description ?? '', author: mr.author?.username ?? 'Unknown',
      sourceBranch: mr.source_branch, targetBranch: mr.target_branch, headSha: mr.diff_refs.head_sha, baseSha: mr.diff_refs.base_sha, baseRepository: String(mr.target_project_id ?? project), repository: String(mr.source_project_id ?? project), files, warnings };
    await recoverFileList(review, host, onProgress, Number.isFinite(count) ? count : undefined);
    await recoverTextDiffs(review, host, onProgress);
    const current = await get<any>(path);
    if (current.diff_refs?.head_sha !== mr.diff_refs.head_sha || current.diff_refs?.base_sha !== mr.diff_refs.base_sha || current.diff_refs?.start_sha !== mr.diff_refs.start_sha) throw new ReviewRecoveryError('The merge request changed while loading. Run the command again for a consistent snapshot.');
    return review;
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
        additions: d.additions, deletions: d.deletions, incomplete: !completePatch(d.patch ?? '') || countChanges(d.patch ?? '').additions !== d.additions || countChanges(d.patch ?? '').deletions !== d.deletions,
        ...(!completePatch(d.patch ?? '') || countChanges(d.patch ?? '').additions !== d.additions || countChanges(d.patch ?? '').deletions !== d.deletions
          ? { diffNote: 'The Git service returned an empty or truncated diff.' } : {}) });
    }
    if (changes.length < 100) break;
  }
  let diffBaseSha: string | undefined;
  try {
    const comparison = await get<any>(`/repos/${projectPath}/compare/${encodeURIComponent(pr.base.sha)}...${encodeURIComponent(pr.head.sha)}?per_page=1`);
    diffBaseSha = comparison.merge_base_commit?.sha;
  } catch { /* Completeness verification below reports an unavailable comparison base. */ }
  const review: Review = { target, title: pr.title, description: pr.body ?? '', author: pr.user.login,
    sourceBranch: pr.head.ref, targetBranch: pr.base.ref, headSha: pr.head.sha, baseSha: diffBaseSha, baseRepository: pr.base.repo?.full_name ?? target.project, repository: pr.head.repo?.full_name ?? target.project, files, warnings };
  await recoverFileList(review, host, onProgress, pr.changed_files);
  await recoverTextDiffs(review, host, onProgress);
  const current = await get<any>(path);
  if (current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha) throw new ReviewRecoveryError('The pull request changed while loading. Run the command again for a consistent snapshot.');
  return review;
}
