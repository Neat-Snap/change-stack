import { applyPatch, createTwoFilesPatch, OMIT_HEADERS } from 'diff';
import { diagnose, diagnosticReason, ServiceError } from './diagnostics';
import { serviceJson } from './network';
import { countChanges, makePatch } from './patches';
import { RepositoryReadError, repositoryReader } from './repository';
import { gitApiBase } from './target';
import type { ChangedFile, HostConfig, Review } from './types';

type Entry = { path: string; sha: string; mode: string; type: string };
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RECOVERY_BYTES = 128 * 1024 * 1024;

export class ReviewRecoveryError extends Error {}

// Verify the manifest independently of diff API limits. Trees contain paths and
// object IDs, not file contents, and always refer to the same pinned snapshot.
async function fileTree(host: HostConfig, ref: string, repository: string, label: string, onProgress?: (message: string) => void): Promise<Map<string, Entry>> {
  const api = gitApiBase(host);
  const auth: Record<string, string> = host.provider === 'gitlab' ? { 'PRIVATE-TOKEN': host.token }
    : { Authorization: `Bearer ${host.token}`, Accept: 'application/vnd.github+json' };
  const get = (path: string) => serviceJson<any>(`${api}${path}`, new URL(api).origin, { headers: auth });
  const entries = new Map<string, Entry>();
  const add = (entry: Entry) => {
    if (typeof entry.path !== 'string' || typeof entry.sha !== 'string' || !entry.sha || !['blob', 'commit'].includes(entry.type)
      || typeof entry.mode !== 'string' || !/^[0-7]{6}$/.test(entry.mode) || (entry.mode === '160000') !== (entry.type === 'commit')) {
      throw new ReviewRecoveryError('The repository returned an invalid file tree.');
    }
    if (entries.has(entry.path)) throw new ReviewRecoveryError('The repository returned duplicate file paths. Diff completeness could not be verified.');
    entries.set(entry.path, entry);
  };
  if (host.provider === 'gitlab') {
    for (let page = 1; page <= 10_000; page++) {
      onProgress?.(`Checking ${label} repository file list: page ${page}`);
      const values = await get(`/projects/${encodeURIComponent(repository)}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=100&page=${page}`);
      if (!Array.isArray(values)) throw new ReviewRecoveryError('The repository did not return a file tree.');
      for (const value of values) if (value.type !== 'tree') add({ ...value, sha: value.id });
      if (values.length < 100) return entries;
    }
  } else {
    const project = repository.split('/').map(encodeURIComponent).join('/');
    const path = `/repos/${project}/git/trees/`;
    onProgress?.(`Checking ${label} repository file list`);
    const recursive = await get(`${path}${encodeURIComponent(ref)}?recursive=1`);
    if (!recursive.truncated) {
      if (!Array.isArray(recursive.tree)) throw new ReviewRecoveryError('The repository did not return a file tree.');
      for (const value of recursive.tree) if (value.type !== 'tree') add(value);
      return entries;
    }
    // GitHub recommends traversing individual trees when recursive output is capped.
    const pending = [{ ref, prefix: '' }];
    for (let reads = 0; pending.length && reads < 10_000; reads++) {
      onProgress?.(`Checking ${label} repository file list: tree ${reads + 1}`);
      const next = pending.shift()!;
      const tree = await get(`${path}${encodeURIComponent(next.ref)}`);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new ReviewRecoveryError('The repository tree is still incomplete.');
      for (const value of tree.tree) {
        const entryPath = next.prefix + value.path;
        if (value.type === 'tree') pending.push({ ref: value.sha, prefix: `${entryPath}/` });
        else add({ ...value, path: entryPath });
      }
    }
    if (!pending.length) return entries;
  }
  throw new ReviewRecoveryError('The repository tree exceeds the recovery request budget. A complete review could not be loaded.');
}

export async function recoverFileList(review: Review, host: HostConfig, onProgress?: (message: string) => void, expectedCount?: number): Promise<void> {
  if (!review.baseSha) throw new ReviewRecoveryError('The comparison base is unavailable. Diff completeness cannot be verified, so review preparation stopped.');
  onProgress?.('Verifying the complete changed-file list against pinned repository trees');
  try {
    const old = await fileTree(host, review.baseSha, review.baseRepository ?? review.target.project, 'base', onProgress);
    const current = await fileTree(host, review.headSha, review.repository ?? review.target.project, 'head', onProgress);
    const coveredOld = new Set(review.files.filter(f => f.status !== 'added').map(f => f.oldPath));
    const coveredNew = new Set(review.files.filter(f => f.status !== 'deleted').map(f => f.path));
    for (const file of review.files) {
      if (file.status !== 'added' && !old.has(file.oldPath) || file.status !== 'deleted' && !current.has(file.path)) {
        throw new ReviewRecoveryError('The changed-file list does not match the pinned repository trees. A consistent review could not be loaded.');
      }
      file.oldMode = old.get(file.oldPath)?.mode; file.newMode = current.get(file.path)?.mode;
      file.oldBlobSha = file.status === 'added' ? undefined : old.get(file.oldPath)?.sha;
      file.newBlobSha = file.status === 'deleted' ? undefined : current.get(file.path)?.sha;
      const before = old.get(file.oldPath), after = current.get(file.path);
      if (before?.type === 'commit' || after?.type === 'commit') setSubmodulePatch(file, before, after);
    }
    for (const path of new Set([...old.keys(), ...current.keys()])) {
      const before = old.get(path), after = current.get(path);
      if (before?.sha === after?.sha && before?.mode === after?.mode) continue;
      const hasOld = before && !coveredOld.has(path), hasNew = after && !coveredNew.has(path);
      if (!hasOld && !hasNew) continue;
      const status = hasOld && hasNew ? 'modified' : hasNew ? 'added' : 'deleted';
      const file: ChangedFile = { path, oldPath: path, status, patch: '', additions: 0, deletions: 0, incomplete: true,
        oldMode: hasOld ? before.mode : undefined, newMode: hasNew ? after.mode : undefined };
      file.oldBlobSha = hasOld ? before.sha : undefined; file.newBlobSha = hasNew ? after.sha : undefined;
      if (before?.type === 'commit' || after?.type === 'commit') {
        setSubmodulePatch(file, hasOld ? before : undefined, hasNew ? after : undefined);
      }
      review.files.push(file);
    }
    if (expectedCount !== undefined && review.files.length < expectedCount) {
      throw new ReviewRecoveryError('The recovered file list still disagrees with the review metadata. A complete review could not be loaded.');
    }
    if (new Set(review.files.map(file => file.path)).size !== review.files.length) {
      throw new ReviewRecoveryError('The review contains overlapping file identities. Diff completeness could not be verified, so review preparation stopped.');
    }
    diagnose({ stage: 'review.files.recovered' });
  } catch (error) {
    if (error instanceof ReviewRecoveryError) throw error;
    throw new ReviewRecoveryError(`Could not recover the complete changed-file list. ${readFailure(error)}`);
  }
}

function setSubmodulePatch(file: ChangedFile, before?: Entry, after?: Entry): void {
  if (before && before.type !== 'commit' || after && after.type !== 'commit') {
    throw new ReviewRecoveryError('A file changed between regular content and a submodule. Its diff could not be verified, so review preparation stopped.');
  }
  const diff = `@@ -${before ? '1' : '0,0'} +${after ? '1' : '0,0'} @@\n${before ? `-Subproject commit ${before.sha}\n` : ''}${after ? `+Subproject commit ${after.sha}\n` : ''}`;
  file.patch = makePatch(file.oldPath, file.path, file.status, diff); Object.assign(file, countChanges(diff));
  file.incomplete = false; file.diffNote = 'Submodule reference change.';
}

function readFailure(error: unknown): string {
  if (error instanceof ReviewRecoveryError) return error.message;
  if (error instanceof RepositoryReadError) return error.message === 'Repository response exceeded the read budget.'
    ? 'File content exceeds the recovery size budget.' : error.message.replace(' to load surrounding code. Its diff is still available.', ' to recover its full diff.');
  if (error instanceof ServiceError) return `Repository content request returned HTTP ${error.status}. Check repository read permissions and connectivity.`;
  return diagnosticReason(error).replace('The model request timed out.', 'The repository content request timed out.');
}

export async function recoverTextDiffs(review: Review, host: HostConfig, onProgress?: (message: string) => void): Promise<void> {
  const textFiles = review.files.filter(file => file.oldMode !== '160000' && file.newMode !== '160000');
  let bytes = 0;
  for (const [index, file] of textFiles.entries()) {
    onProgress?.(`Verifying complete file diffs: ${index + 1}/${textFiles.length}`);
    const original = file.diffNote ?? 'The diff could not be verified against pinned file contents.';
    try {
      const read = async (path: string, old: boolean): Promise<{ content: string; binary?: boolean }> => {
        const ref = old ? review.baseSha : review.headSha;
        const blobSha = old ? file.oldBlobSha : file.newBlobSha;
        if (!ref) throw new ReviewRecoveryError('The comparison base is unavailable; refusing to substitute the current target branch.');
        if (!blobSha) throw new ReviewRecoveryError('The pinned file object is unavailable; refusing an unverified content read.');
        const maxBytes = Math.min(MAX_FILE_BYTES, MAX_RECOVERY_BYTES - bytes);
        if (maxBytes <= 0) throw new RepositoryReadError('The review exceeds the diff recovery size budget.');
        const reader = repositoryReader(review, host, { ref, repository: old ? review.baseRepository : review.repository,
          raw: true, strictText: true, maxBytes, blobSha, allowBinary: true });
        const value = await reader({ tool: 'read_file', path }) as { content: string; binary?: boolean; bytes: number };
        bytes += value.bytes;
        return value;
      };
      // Added/deleted files have only one side. Never interpret a failed read as empty content.
      const before = file.status === 'added' ? { content: '' } : await read(file.oldPath, true);
      const after = file.status === 'deleted' ? { content: '' } : await read(file.path, false);
      if (before.binary || after.binary) {
        if (file.patch) throw new ReviewRecoveryError('This file has both binary content and a textual patch. Its full text diff could not be verified.');
        file.diffNote = 'Binary content has no textual diff.'; file.incomplete = false;
        review.warnings.push(`${file.path}: ${file.diffNote}`);
        continue;
      }
      const old = before.content, current = after.content;
      let verified = false;
      try { verified = !!file.patch && applyPatch(old, file.patch) === current; } catch { /* Rebuild invalid patches from pinned content. */ }
      if (!verified) {
        const diff = createTwoFilesPatch(file.oldPath, file.path, old, current, undefined, undefined,
          { context: 3, timeout: 2000, headerOptions: OMIT_HEADERS });
        if (diff === undefined) throw new ReviewRecoveryError('Rebuilding this diff exceeded the computation budget.');
        const patch = makePatch(file.oldPath, file.path, file.status, diff.trim() ? diff : '');
        if (patch && applyPatch(old, patch) !== current) throw new ReviewRecoveryError('The rebuilt diff did not reproduce the pinned head content.');
        file.patch = patch;
      }
      Object.assign(file, countChanges(file.patch)); file.incomplete = false;
      file.diffNote = file.patch ? undefined : 'No text changes; this file has only a rename, mode change, or empty-file change.';
      diagnose({ stage: verified ? 'review.diff.verified' : 'review.diff.recovered' });
    } catch (error) {
      file.incomplete = true;
      file.diffNote = `${original} Recovery failed: ${error instanceof ReviewRecoveryError ? error.message : readFailure(error)}`;
      diagnose({ stage: 'review.diff.failed', error: readFailure(error) });
    }
    if (file.diffNote) review.warnings.push(`${file.path}: ${file.diffNote}`);
  }
  const unresolved = review.files.filter(file => file.incomplete);
  if (unresolved.length) throw new ReviewRecoveryError(`Complete diff data could not be loaded for ${unresolved.length} file${unresolved.length === 1 ? '' : 's'}. Review preparation stopped.\n${unresolved.map(file => `${file.path}: ${file.diffNote}`).join('\n')}`);
}
