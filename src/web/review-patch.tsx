import React, { useMemo, useRef } from 'react';
import { SplitDivider } from './split-divider';
import { PatchDiff } from '@pierre/diffs/react';
import type { ReviewTheme } from './themes';
import type { PartAnchor } from '../core/changes';
import type { LayerPart } from '../core/types';

export async function readApi<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Repository lookup failed.');
  return value;
}
export interface LineTarget { path: string; line: number; side: 'old' | 'current'; serial: number }
// A slim, full-width band instead of Pierre's default rounded pill for hidden lines.
const separatorCSS = `[data-diff-type=split][data-overflow=scroll]{grid-template-columns:minmax(0,var(--change-stack-split-left,50%)) minmax(0,1fr)}
[data-separator=line-info-basic]{height:24px;background-color:color-mix(in srgb,var(--diffs-bg-separator) 45%,var(--diffs-bg))}
[data-separator=line-info-basic] [data-separator-wrapper],[data-separator=line-info-basic] [data-separator-content]{background-color:transparent}
[data-separator=line-info-basic] [data-separator-content]{font-size:11px;letter-spacing:.01em}`;

export interface PartNotes { parts: LayerPart[]; anchors: PartAnchor[] }
export function PartNote({ index, part }: { index: number; part: LayerPart }) {
  return <div className="flex items-baseline gap-2 border-y bg-sidebar px-3 py-1.5 font-sans text-xs leading-5" data-testid="part-note">
    <span className="flex size-4 shrink-0 translate-y-0.5 items-center justify-center self-start rounded-full bg-foreground text-[10px] font-semibold text-background">{index + 1}</span>
    <span className="shrink-0 font-medium text-foreground">{part.title}</span>
    <span className="line-clamp-2 min-w-0 text-muted-foreground" title={part.summary}>{part.summary}</span>
  </div>;
}
export function ReviewPatch({ patch, path, theme, layout, lookup, target, splitRatio, onSplitRatioChange, notes }: {
  patch: string; path: string; theme: ReviewTheme; layout: 'split' | 'unified';
  lookup: (symbol: string, path: string) => void; target?: LineTarget;
  splitRatio?: number; onSplitRatioChange?: (value: number) => void; notes?: PartNotes;
}) {
  const lookupRef = useRef(lookup); lookupRef.current = lookup;
  // Resizing changes inherited CSS only; keep Pierre's rendered patch stable.
  const diff = useMemo(() => (
    <PatchDiff patch={patch} lineAnnotations={notes?.anchors.map(({ part, side, lineNumber }) => ({ side, lineNumber, metadata: part }))}
      renderAnnotation={annotation => <PartNote index={annotation.metadata} part={notes!.parts[annotation.metadata]!} />} selectedLines={target?.path === path ? { start: target.line, end: target.line, side: target.side === 'old' ? 'deletions' : 'additions' } : undefined}
      options={{ theme, themeType: theme.endsWith('dark') ? 'dark' : 'light', diffStyle: layout, preferredHighlighter: 'shiki-js',
        enableLineSelection: true, disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: separatorCSS, useTokenTransformer: true,
        onTokenClick: (token, event) => {
          if (event.altKey) { event.preventDefault(); const symbol = token.tokenText.trim(); if (/^[A-Za-z_$][\w$]{1,79}$/.test(symbol)) lookupRef.current(symbol, path); }
        },
      }} />
  ), [patch, target, path, theme, layout, notes]);
  return <div className="relative" data-testid="patch-pane">
    {layout === 'split' && splitRatio !== undefined && onSplitRatioChange && <SplitDivider value={splitRatio} onChange={onSplitRatioChange} path={path} />}
    {diff}
  </div>;
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
