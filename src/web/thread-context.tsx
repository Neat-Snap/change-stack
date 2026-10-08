import React, { useMemo } from 'react';
import { ArrowUpRight, Layers } from 'lucide-react';
import { diffSnippet, findDiffLine, layerFile, type LineRange, type SnippetRow } from '../core/changes';
import type { Layer, Review, ReviewThread } from '../core/types';

export function threadContext(review: Review, layers: Layer[], thread: ReviewThread) {
  const position = thread.position;
  if (!position || thread.outdated) return;
  const file = position.side === 'old'
    ? review.files.find(file => file.oldPath === position.path) ?? review.files.find(file => file.path === position.path)
    : review.files.find(file => file.path === position.path);
  if (!file || !findDiffLine(file, position.line, position.side)) return;
  const range: LineRange = { start: position.startLine ?? position.line, side: position.startLine ? position.startSide ?? position.side : position.side, end: position.line, endSide: position.side };
  const rows = diffSnippet(file, range) ?? diffSnippet(file, { start: position.line, end: position.line, side: position.side });
  if (!rows) return;
  const selected = (diffSnippet(file, range, Infinity) ?? rows).filter(row => !('omitted' in row) && row.selected);
  const destinations = layers.flatMap((layer, index) => {
    if (!layer.files.includes(file.path)) return [];
    const patch = layer.ranges ? layerFile(file, layer.ranges) : file;
    // Prefer the thread's end; if a range spans layers, select its last visible row there.
    const anchor = selected.toReversed().find(row => {
      if ('omitted' in row) return false;
      const side = row.kind === '-' ? 'old' : row.kind === '+' ? 'current' : position.side;
      return !!findDiffLine(patch, side === 'old' ? row.old : row.current, side);
    });
    if (!anchor || 'omitted' in anchor) return [];
    const side = anchor.kind === '-' ? 'old' as const : anchor.kind === '+' ? 'current' as const : position.side;
    return [{ layer, number: index + 1, line: side === 'old' ? anchor.old : anchor.current, side }];
  });
  return { rows, destinations };
}

function CodeRows({ rows }: { rows: SnippetRow[] }) {
  return <div className="overflow-x-auto border-t font-mono text-[11px] leading-5" data-testid="thread-code-snippet">
    <div className="w-max min-w-full py-1">
      {rows.map((row, index) => 'omitted' in row ? <div key={index} className="px-4 text-muted-foreground">⋯ {row.omitted} selected lines omitted ⋯</div> :
        <div key={index} data-selected={row.selected} className={`grid grid-cols-[3rem_3rem_1rem_minmax(max-content,1fr)] border-l-2 ${row.selected ? 'border-blue-500' : 'border-transparent'} ${row.kind === '+' ? 'bg-green-500/10' : row.kind === '-' ? 'bg-red-500/10' : row.selected ? 'bg-blue-500/5' : ''}`}>
          <span className="select-none pr-2 text-right tabular-nums text-muted-foreground">{row.kind !== '+' && row.old > 0 ? row.old : ''}</span>
          <span className="select-none pr-2 text-right tabular-nums text-muted-foreground">{row.kind !== '-' && row.current > 0 ? row.current : ''}</span>
          <span aria-hidden className={`select-none ${row.kind === '+' ? 'text-green-600 dark:text-green-400' : row.kind === '-' ? 'text-red-600 dark:text-red-400' : ''}`}>{row.kind}</span>
          <code className="whitespace-pre pr-4 text-foreground">{row.text || ' '}</code>
        </div>)}
    </div>
  </div>;
}

export function ThreadCodeContext({ review, layers, thread, jump }: {
  review: Review; layers: Layer[]; thread: ReviewThread;
  jump: (thread: ReviewThread, destination?: { layerId: string; line: number; side: 'old' | 'current' }) => void;
}) {
  const context = useMemo(() => threadContext(review, layers, thread), [review, layers, thread]), position = thread.position;
  const endLabel = position ? `${position.side === 'old' ? 'old ' : ''}line ${position.line}` : '';
  const label = position?.startLine && (position.startLine !== position.line || (position.startSide ?? position.side) !== position.side)
    ? `${(position.startSide ?? position.side) === 'old' ? 'old ' : ''}line ${position.startLine} → ${endLabel}` : endLabel;
  const historical = !context && thread.diffHunk ? diffSnippet({ patch: thread.diffHunk } as Review['files'][number], position
    ? { start: position.startLine ?? position.line, end: position.line, side: position.startLine ? position.startSide ?? position.side : position.side, endSide: position.side } : { start: 0, end: 0, side: 'current' }) : undefined;
  if (thread.kind !== 'diff') return null;
  return <div className="bg-sidebar/30" data-testid="thread-code-context">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
      <span className="min-w-0 flex-1 break-all font-mono text-muted-foreground">{position?.path ?? thread.path ?? 'Code context'}{position && ` · ${label}`}</span>
      {context && <button onClick={() => jump(thread)} className="flex shrink-0 items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">View in diff<ArrowUpRight className="size-3" /></button>}
    </div>
    {context ? <CodeRows rows={context.rows} /> : historical ? <><p className="border-t px-3 py-1 text-[10px] text-muted-foreground">Original comment context · earlier revision</p><CodeRows rows={historical} /></> :
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">{thread.outdated ? 'This thread refers to an earlier revision.' : 'This code is outside the loaded diff.'} <a href={thread.comments[0].url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">View original context</a></p>}
    {context && <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-[11px]">
      <span className="mr-1 flex items-center gap-1 text-muted-foreground"><Layers className="size-3" />Layers</span>
      {context.destinations.length ? context.destinations.map(destination => <button key={destination.layer.id} title={destination.layer.summary}
        onClick={() => jump(thread, { layerId: destination.layer.id, line: destination.line, side: destination.side })}
        className="flex max-w-full items-center gap-1 rounded border bg-background px-2 py-0.5 text-foreground hover:bg-accent">
        <span className="truncate">{destination.number}. {destination.layer.title}</span><ArrowUpRight className="size-3 shrink-0" />
      </button>) : <span className="text-muted-foreground">No layer includes this line</span>}
    </div>}
  </div>;
}
