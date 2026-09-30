import React, { Component, useMemo, useState } from 'react';
import { ChevronRight, FoldVertical, PanelRightOpen, SearchCode, UnfoldVertical } from 'lucide-react';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible';
import { ReviewPatch, readApi, type LineTarget, type PartNotes } from './review-patch';
import { layerFile, partAnchors, wholeRanges, type SourcePair } from '../core/changes';
import type { ChangedFile, ChangeRange, LayerPart } from '../core/types';
import type { ReviewTheme } from './themes';

class DiffBoundary extends Component<{ children: React.ReactNode; patch: string }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="p-4"><p className="mb-3 text-sm text-muted-foreground">Unable to render this patch.</p>
      <pre className="overflow-auto font-mono text-xs leading-6">{this.props.patch}</pre></div>;
  }
}

const statusStyle = {
  added: ['A', 'text-green-600 dark:text-green-400'], modified: ['M', 'text-amber-600 dark:text-amber-400'],
  deleted: ['D', 'text-red-600 dark:text-red-400'], renamed: ['R', 'text-violet-600 dark:text-violet-400'],
} as const;

export function Counts({ additions, deletions, className = '' }: { additions: number; deletions: number; className?: string }) {
  return <span className={`font-mono text-[11px] tabular-nums ${className}`}>
    <span className="text-green-600 dark:text-green-400">+{additions}</span> <span className="text-red-600 dark:text-red-400">−{deletions}</span>
  </span>;
}

function FilePath({ file }: { file: ChangedFile }) {
  const split = file.path.lastIndexOf('/');
  return <span className="min-w-0 truncate font-mono" title={file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}>
    {file.oldPath !== file.path && <span className="text-muted-foreground">{file.oldPath} → </span>}
    <span className="text-muted-foreground">{file.path.slice(0, split + 1)}</span>
    <span className="font-medium text-foreground">{file.path.slice(split + 1)}</span>
  </span>;
}

export function FileSection({ file, original, ranges, parts, otherLayers, reviewed, collapsed, onCollapsedChange, onReviewedChange, onWholeFile, onPeek,
  sectionRef, theme, layout, splitRatio, onSplitRatioChange, contextAvailable, lookup, target }: {
  file: ChangedFile; original: ChangedFile; ranges?: ChangeRange[]; parts?: LayerPart[]; otherLayers: number;
  reviewed: boolean; collapsed: boolean; onCollapsedChange: (value: boolean) => void; onReviewedChange: (value: boolean) => void;
  onWholeFile: () => void; onPeek: () => void; sectionRef: (element: HTMLElement | null) => void;
  theme: ReviewTheme; layout: 'split' | 'unified'; splitRatio: number; onSplitRatioChange: (value: number) => void;
  contextAvailable: boolean; lookup: (symbol: string, path: string) => void; target?: LineTarget;
}) {
  const [source, setSource] = useState<SourcePair>(), [context, setContext] = useState(3);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const displayed = useMemo(() => ranges || context > 3 ? layerFile(original, ranges ?? wholeRanges([original]), context, source) : original, [original, ranges, context, source]);
  async function expand() {
    setLoading(true); setError('');
    try {
      const loaded = source ?? await readApi<SourcePair>('/api/context', { path: original.path });
      const next = Math.min(context + 20, 203);
      const expanded = layerFile(original, ranges ?? wholeRanges([original]), next, loaded);
      setSource(loaded); setContext(next); setExhausted(expanded.patch === displayed.patch);
    }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  const notes = useMemo<PartNotes | undefined>(() => parts?.length ? { parts, anchors: partAnchors(original, parts) } : undefined, [original, parts]);
  const canExpand = contextAvailable && (file.status === 'modified' || file.status === 'renamed');
  const partial = !!ranges && (file.additions !== original.additions || file.deletions !== original.deletions);
  const [letter, color] = statusStyle[file.status];
  const tool = 'size-7 shrink-0 text-muted-foreground';

  return <section ref={sectionRef} aria-label={file.path} className="diff-container border-b bg-background" data-testid="file-diff">
    <Collapsible open={!collapsed} onOpenChange={open => onCollapsedChange(!open)}>
      <div className="group sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-sidebar px-3 text-xs">
        <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-2 text-left" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}>
          <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span className={`w-2.5 shrink-0 text-center font-mono text-[11px] font-semibold ${color}`} title={file.status}>{letter}</span>
          <span className={`flex min-w-0 ${reviewed ? 'opacity-60' : ''}`}><FilePath file={file} /></span>
        </CollapsibleTrigger>
        {partial && <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground" data-testid="file-scope"
          title={`This layer shows +${file.additions} −${file.deletions} of the file's +${original.additions} −${original.deletions}`}>
          <span className="hidden md:inline">Part of file{otherLayers ? ` · ${otherLayers} other ${otherLayers === 1 ? 'layer' : 'layers'}` : ''}</span>
          <Button variant="ghost" size="icon" className={tool} onClick={onWholeFile} aria-label={`Show whole file ${file.path}`} title="Show every change to this file in a side panel"><PanelRightOpen className="size-3.5" /></Button>
        </span>}
        <div className="flex max-w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 group-focus-within:max-w-24 group-focus-within:opacity-100 group-hover:max-w-24 group-hover:opacity-100 max-md:max-w-24 max-md:opacity-100" data-testid="file-tools">
          {canExpand && !collapsed && context > 3 && <Button variant="ghost" size="icon" className={tool} title="Hide nearby code" aria-label={`Reset context ${file.path}`}
            onClick={() => { setContext(3); setExhausted(false); }}><FoldVertical className="size-3.5" /></Button>}
          {canExpand && !collapsed && <Button variant="ghost" size="icon" className={tool} disabled={loading || exhausted || context >= 203}
            title={exhausted ? 'No more nearby unchanged lines' : 'Show 20 more unchanged lines around the edits. Stops at changes outside this layer.'}
            onClick={() => void expand()} aria-label={`Expand context ${file.path}`}><UnfoldVertical className="size-3.5" /></Button>}
          <Button variant="ghost" size="icon" className={tool} aria-label={`Look up symbol ${file.path}`} title="Look up symbol (or Alt-click a code token)" onClick={onPeek}><SearchCode className="size-3.5" /></Button>
        </div>
        <Counts additions={file.additions} deletions={file.deletions} className="hidden sm:inline" />
        <Checkbox checked={reviewed} onCheckedChange={checked => onReviewedChange(checked === true)} aria-label={`Mark ${file.path} as reviewed`} title="Reviewed" className="ml-1" />
      </div>
      <CollapsibleContent data-testid="file-diff-content">
        {(error || loading) && <p role="status" className="border-b px-3 py-1.5 text-xs text-muted-foreground">{loading ? 'Loading nearby code…' : error}</p>}
        {file.incomplete && <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">This patch is incomplete.</p>}
        {displayed.patch ? <DiffBoundary patch={displayed.patch}>
          <ReviewPatch patch={displayed.patch} path={file.path} theme={theme} layout={layout} splitRatio={splitRatio} onSplitRatioChange={onSplitRatioChange} lookup={lookup} target={target} notes={notes} />
        </DiffBoundary> : <p className="px-3 py-3 text-xs text-muted-foreground">No text patch available.</p>}
      </CollapsibleContent>
    </Collapsible>
  </section>;
}
