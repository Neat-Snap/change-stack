import React, { useMemo, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { Button } from './components/ui/button';
import { layerFile, wholeRanges, type SourcePair } from '../core/changes';
import type { ChangedFile, ChangeRange } from '../core/types';
import type { ReviewTheme } from './themes';

export async function readApi<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Repository lookup failed.');
  return value;
}
export interface LineTarget { path: string; line: number; side: 'old' | 'current'; serial: number }
export function ReviewPatch({ file, ranges, theme, layout, contextAvailable, lookup, target }: {
  file: ChangedFile; ranges?: ChangeRange[]; theme: ReviewTheme; layout: 'split' | 'unified'; contextAvailable: boolean;
  lookup: (symbol: string, path: string) => void; target?: LineTarget;
}) {
  const [source, setSource] = useState<SourcePair>(), [context, setContext] = useState(3);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const displayed = useMemo(() => ranges || context > 3 ? layerFile(file, ranges ?? wholeRanges([file]), context, source) : file, [file, ranges, context, source]);
  async function expand() {
    setLoading(true); setError('');
    try {
      const loaded = source ?? await readApi<SourcePair>('/api/context', { path: file.path });
      const next = Math.min(context + 20, 203);
      const expanded = layerFile(file, ranges ?? wholeRanges([file]), next, loaded);
      setSource(loaded); setContext(next); setExhausted(expanded.patch === displayed.patch);
    }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  return <>
    {contextAvailable && (file.status === 'modified' || file.status === 'renamed') && <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 text-xs text-muted-foreground">
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={loading || exhausted || context >= 203} title="Adds unchanged lines before and after the edits. Stops at changes outside this layer." onClick={() => void expand()} aria-label={`Expand context ${file.path}`}>{loading ? 'Loading…' : 'Show nearby unchanged code'}</Button>
      {context > 3 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setContext(3); setExhausted(false); }}>Reset context</Button>}
      {exhausted && !error && <span role="status">No more unchanged lines beside these edits.</span>}
      {context > 3 && !exhausted && !error && <span>{ranges ? 'Unchanged code only · other layer edits stay hidden' : 'Unchanged lines added around the edits'}</span>}
      {error && <span role="status">{error}</span>}
    </div>}
    <PatchDiff patch={displayed.patch} selectedLines={target?.path === file.path ? { start: target.line, end: target.line, side: target.side === 'old' ? 'deletions' : 'additions' } : undefined}
      options={{ theme, themeType: theme.endsWith('dark') ? 'dark' : 'light', diffStyle: layout, preferredHighlighter: 'shiki-js',
        enableLineSelection: true, disableFileHeader: true, useTokenTransformer: true,
        onTokenClick: (token, event) => {
          if (event.altKey) { event.preventDefault(); const symbol = token.tokenText.trim(); if (/^[A-Za-z_$][\w$]{1,79}$/.test(symbol)) lookup(symbol, file.path); }
        },
      }} />
  </>;
}

// Estimate the visible patch row before Pierre mounts that window. A second
// scroll to the rendered line refines the position after virtualization runs.
export function patchLineOffset(patch: string, line: number, side: 'old' | 'current', layout: 'split' | 'unified'): number {
  let old = 0, current = 0, row = 0;
  const lines = patch.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i], match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (match) { old = +match[1]; current = +match[2]; row += 1.6; continue; }
    if (text[0] === ' ') { if ((side === 'old' ? old : current) === line) return row * 20; old++; current++; row++; }
    else if (['+', '-'].includes(text[0]) && !/^[-+]{3}/.test(text)) {
      let additions = 0, deletions = 0;
      while (i < lines.length && ['+', '-', '\\'].includes(lines[i][0])) {
        const kind = lines[i][0];
        if (kind === '+' && side === 'current' && current === line) return (row + (layout === 'split' ? additions : additions + deletions)) * 20;
        if (kind === '-' && side === 'old' && old === line) return (row + (layout === 'split' ? deletions : additions + deletions)) * 20;
        if (kind === '+') { current++; additions++; } if (kind === '-') { old++; deletions++; } i++;
      }
      i--; row += layout === 'split' ? Math.max(additions, deletions) : additions + deletions;
    }
  }
  return 0;
}
