import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LineActions, LINE_ACTIONS_DELAY_MS, type LineSelection } from './line-actions';
import { SplitDivider } from './split-divider';
import { PatchDiff } from '@pierre/diffs/react';
import type { SelectedLineRange } from '@pierre/diffs';
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
interface ReviewPatchProps {
  patch: string; path: string; theme: ReviewTheme; layout: 'split' | 'unified';
  lookup: (symbol: string, path: string) => void; target?: LineTarget;
  splitRatio?: number; onSplitRatioChange?: (value: number) => void; notes?: PartNotes;
}
export function ReviewPatch(props: ReviewPatchProps) {
  // A draft is tied to its file, including when the whole-file panel is reused.
  return <ReviewPatchContent key={props.path} {...props} />;
}
function ReviewPatchContent({ patch, path, theme, layout, lookup, target, splitRatio, onSplitRatioChange, notes }: ReviewPatchProps) {
  const lookupRef = useRef(lookup); lookupRef.current = lookup;
  const [selection, setSelection] = useState<LineSelection>();
  const wrapper = useRef<HTMLDivElement>(null), pointer = useRef({ x: 0, y: 0, at: 0 }), timer = useRef<ReturnType<typeof setTimeout>>(undefined), draft = useRef(false);
  const close = useCallback(() => { clearTimeout(timer.current); pointer.current.at = 0; setSelection(undefined); }, []);
  useEffect(() => {
    const cancelPending = () => { clearTimeout(timer.current); pointer.current.at = 0; };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelPending(); };
    window.addEventListener('pointerdown', cancelPending, true);
    window.addEventListener('keydown', onKey);
    return () => { cancelPending(); window.removeEventListener('pointerdown', cancelPending, true); window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { clearTimeout(timer.current); pointer.current.at = 0; }, [patch, target, layout]);
  // Only pointer selections offer actions; programmatic jumps also select lines.
  const selected = useRef((range: SelectedLineRange | null) => {
    clearTimeout(timer.current);
    if (draft.current) return;
    setSelection(undefined);
    if (!range || Date.now() - pointer.current.at > 1_000) return;
    const { x, y } = pointer.current;
    timer.current = setTimeout(() => setSelection({ side: range.side === 'deletions' ? 'old' : 'current', endSide: (range.endSide ?? range.side) === 'deletions' ? 'old' : 'current', start: range.start, end: range.end, x, y }), LINE_ACTIONS_DELAY_MS);
  });
  // Resizing changes inherited CSS only; keep Pierre's rendered patch stable.
  const diff = useMemo(() => (
    <PatchDiff patch={patch} lineAnnotations={notes?.anchors.map(({ part, side, lineNumber }) => ({ side, lineNumber, metadata: part }))}
      renderAnnotation={annotation => <PartNote index={annotation.metadata} part={notes!.parts[annotation.metadata]!} />} selectedLines={target?.path === path ? { start: target.line, end: target.line, side: target.side === 'old' ? 'deletions' : 'additions' } : undefined}
      options={{ theme, themeType: theme.endsWith('dark') ? 'dark' : 'light', diffStyle: layout, preferredHighlighter: 'shiki-js',
        enableLineSelection: true, disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: separatorCSS, useTokenTransformer: true,
        onLineSelected: range => selected.current(range),
        onTokenClick: (token, event) => {
          if (event.altKey) { event.preventDefault(); const symbol = token.tokenText.trim(); if (/^[A-Za-z_$][\w$]{1,79}$/.test(symbol)) lookupRef.current(symbol, path); }
        },
      }} />
  ), [patch, target, path, theme, layout, notes]);
  return <div ref={wrapper} className="relative" data-testid="patch-pane" onPointerUp={event => {
    const rect = wrapper.current!.getBoundingClientRect();
    pointer.current = { x: Math.max(8, Math.min(event.clientX - rect.left - 12, rect.width - 240)), y: event.clientY - rect.top + 14, at: Date.now() };
  }}>
    {layout === 'split' && splitRatio !== undefined && onSplitRatioChange && <SplitDivider value={splitRatio} onChange={onSplitRatioChange} path={path} />}
    {diff}
    {selection && <LineActions key={`${selection.side}:${selection.start}:${selection.endSide}:${selection.end}`} path={path} selection={selection} close={close} draft={draft} />}
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
