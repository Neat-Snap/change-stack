import type { ChangedFile } from './types';

export function makePatch(oldPath: string, path: string, status: ChangedFile['status'], diff: string): string {
  if (!diff) return '';
  return `diff --git ${JSON.stringify(`a/${oldPath}`)} ${JSON.stringify(`b/${path}`)}\n--- ${status === 'added' ? '/dev/null' : JSON.stringify(`a/${oldPath}`)}\n+++ ${status === 'deleted' ? '/dev/null' : JSON.stringify(`b/${path}`)}\n${diff}${diff.endsWith('\n') ? '' : '\n'}`;
}

// Inside a hunk, +++ and --- can be real changed code rather than file headers.
export function countChanges(diff: string): { additions: number; deletions: number } {
  let additions = 0, deletions = 0, inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('@@ ')) inHunk = true;
    else if (inHunk && line.startsWith('+')) additions++;
    else if (inHunk && line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

export function completePatch(diff: string): boolean {
  let old = 0, current = 0, hunks = 0;
  for (const line of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (old || current) return false;
      old = Number(header[2] ?? 1); current = Number(header[4] ?? 1); hunks++;
    } else if (hunks && [' ', '+', '-'].includes(line[0]!)) {
      if (line[0] !== '+') old--;
      if (line[0] !== '-') current--;
      if (old < 0 || current < 0) return false;
    } else if (line && hunks && !line.startsWith('\\ No newline')) return false;
  }
  return hunks > 0 && old === 0 && current === 0;
}
