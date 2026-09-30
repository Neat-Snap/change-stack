import React from 'react';
import { Check, ChevronRight, Network } from 'lucide-react';
import { Summary } from './summary';
import { Counts } from './file-section';
import { CategoryPill } from './layer-map';
import { Button } from './components/ui/button';
import type { Analysis, Layer, Review } from '../core/types';

export interface LayerStat { paths: string[]; additions: number; deletions: number }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const reviewRef = (review: Review) => `${review.target.provider === 'gitlab' ? '!' : '#'}${review.target.number}`;

export function ReviewIntro({ review, analysis, layer, stats, reviewed, choose, jumpToPart, openMap, ref }: {
  review: Review; analysis: Analysis; layer?: Layer; stats: LayerStat[]; reviewed: Set<string>;
  choose: (id: string) => void; jumpToPart: (index: number) => void; openMap: () => void; ref: React.Ref<HTMLDivElement>;
}) {
  const index = analysis.layers.findIndex(l => l.id === layer?.id);
  const position = (id: string) => analysis.layers.findIndex(l => l.id === id);
  if (layer) {
    const stat = stats[index]!, group = analysis.groups?.find(g => g.layers.includes(layer.id));
    return <div ref={ref} className="scroll-mt-0 border-b px-5 pb-5 pt-4">
      <div className="max-w-3xl">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="diff-scope">
          <span className="tabular-nums">Layer {index + 1} of {analysis.layers.length}</span>
          {group && <><span aria-hidden>·</span><span>{group.title}</span></>}<span aria-hidden>·</span>
          <span>{plural(stat.paths.length, 'file')}</span><Counts additions={stat.additions} deletions={stat.deletions} /><span aria-hidden>·</span>
          <span>{layer.ranges ? 'Only changes assigned to this layer' : 'All changes in these files'}</span>
        </p>
        <h1 className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold leading-6 text-foreground">{layer.title}<CategoryPill category={layer.category} /></h1>
        {!!layer.dependsOn?.length && <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="layer-depends">
          <span>Builds on</span>{layer.dependsOn.map(id => <button key={id} className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground" onClick={() => choose(id)}>
            {position(id) + 1}. {analysis.layers[position(id)]?.title}</button>)}
        </p>}
        <div className="mt-2" data-testid="layer-summary"><Summary text={layer.summary} /></div>
        {!!layer.parts?.length && <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Parts of this layer" data-testid="layer-parts">
          {layer.parts.map((part, i) => <li key={i}><button className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => jumpToPart(i)} title={part.summary}>
            <span className="flex size-4 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground group-hover:bg-foreground group-hover:text-background">{i + 1}</span>{part.title}
          </button></li>)}
        </ol>}
      </div>
    </div>;
  }
  const additions = review.files.reduce((n, f) => n + f.additions, 0), deletions = review.files.reduce((n, f) => n + f.deletions, 0);
  const groups = analysis.groups?.length ? analysis.groups : [{ id: 'all', title: '', layers: analysis.layers.map(l => l.id) }];
  return <div ref={ref} className="scroll-mt-0 border-b px-5 pb-5 pt-4" data-testid="pr-summary">
    <div>
      <h1 className="text-base font-semibold leading-6 text-foreground">{review.title}</h1>
      <div className="mt-2"><Summary text={analysis.summary} /></div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="pr-statistics">
        <span>{plural(review.files.length, 'file')}</span><Counts additions={additions} deletions={deletions} />
        <span aria-hidden>·</span><span>{plural(analysis.layers.length, 'layer')}</span>
        <span aria-hidden>·</span><span data-testid="diff-scope">All PR changes below</span>
      </p>
      {analysis.layers.length > 0 && <nav className="mt-4" aria-label="Reading order">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Reading order</p>
          {analysis.layers.length > 1 && <Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs text-muted-foreground" onClick={openMap} title="Layer map (G)"><Network className="size-3.5" />Layer map</Button>}
        </div>
        {groups.map(group => <div key={group.id}>
          {group.title && <p className="mt-2 text-[11px] text-muted-foreground">{group.title}</p>}
          <ol className="-mx-2">{group.layers.map(id => {
            const i = position(id), l = analysis.layers[i]!, stat = stats[i]!, done = stat.paths.length > 0 && stat.paths.every(path => reviewed.has(path));
            return <li key={id}><button className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => choose(id)}>
              <span className="flex w-4 shrink-0 justify-center text-[11px] tabular-nums text-muted-foreground">{done ? <Check className="size-3.5 text-green-600 dark:text-green-400" aria-label="Reviewed" /> : i + 1}</span>
              <span className="min-w-0 truncate text-[13px] text-foreground">{l.title}</span>
              <CategoryPill category={l.category} />
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{plural(stat.paths.length, 'file')}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button></li>;
          })}</ol>
        </div>)}
      </nav>}
    </div>
  </div>;
}

export function NextLayer({ next, index, choose, overview }: { next?: Layer; index: number; choose: (id: string) => void; overview: () => void }) {
  return <button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent/60" onClick={() => next ? choose(next.id) : overview()}>
    <span className="min-w-0"><span className="block text-xs text-muted-foreground">{next ? 'Up next' : 'Last layer'}</span>
      <span className="block truncate text-[13px] font-medium">{next ? `${index + 2}. ${next.title}` : 'Back to overview'}</span></span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
  </button>;
}
