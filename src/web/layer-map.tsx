import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Analysis, Layer } from '../core/types';
import type { LayerStat } from './review-intro';

const pillColors = [
  'bg-sky-500/12 text-sky-700 dark:text-sky-300', 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/12 text-rose-700 dark:text-rose-300', 'bg-teal-500/12 text-teal-700 dark:text-teal-300',
];
// Categories are free text, so a stable hash keeps one label on one color across the review.
export function CategoryPill({ category, className = '' }: { category?: string; className?: string }) {
  if (!category) return null;
  let hash = 0;
  for (const char of category.toLocaleLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return <span className={`inline-block h-4 max-w-full min-w-0 truncate rounded px-1.5 text-[10px] font-medium leading-4 ${pillColors[hash % pillColors.length]} ${className}`} data-testid="layer-category">{category}</span>;
}

interface Edge { id: string; d: string; from: string; to: string }

export function LayerMap({ analysis, stats, reviewed, active, choose }: {
  analysis: Analysis; stats: LayerStat[]; reviewed: Set<string>; active: string; choose: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<Edge[]>([]), [hovered, setHovered] = useState<string>();
  const focus = hovered ?? (active === 'all' ? undefined : active);
  const index = new Map(analysis.layers.map((l, i) => [l.id, i]));
  // Dependencies point only to earlier layers, so one pass in reading order yields each depth.
  const depth = new Map<string, number>();
  for (const l of analysis.layers) depth.set(l.id, Math.max(0, ...(l.dependsOn ?? []).map(id => (depth.get(id) ?? 0) + 1)));
  const sections = analysis.groups?.length
    ? analysis.groups.map(g => ({ id: g.id, title: g.title, layers: g.layers.map(id => analysis.layers[index.get(id)!]!).filter(Boolean) }))
    : [{ id: 'all', title: '', layers: analysis.layers }];
  const hasEdges = analysis.layers.some(l => l.dependsOn?.length);

  useLayoutEffect(() => {
    const root = container.current; if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect(), next: Edge[] = [];
      for (const layer of analysis.layers) for (const from of layer.dependsOn ?? []) {
        const a = nodes.current.get(from)?.getBoundingClientRect(), b = nodes.current.get(layer.id)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = a.left + a.width / 2 - base.left, y1 = a.bottom - base.top, x2 = b.left + b.width / 2 - base.left, y2 = b.top - base.top;
        const bend = Math.max(28, Math.abs(y2 - y1) / 2);
        next.push({ id: `${from}>${layer.id}`, d: `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2 - 4}`, from, to: layer.id });
      }
      setEdges(next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(root);
    return () => observer.disconnect();
  }, [analysis]);

  const node = (layer: Layer) => {
    const i = index.get(layer.id)!, stat = stats[i]!, done = stat.paths.length > 0 && stat.paths.every(path => reviewed.has(path));
    return <button key={layer.id} ref={element => { if (element) nodes.current.set(layer.id, element); else nodes.current.delete(layer.id); }}
      data-active={layer.id === active} onClick={() => choose(layer.id)} data-testid="map-node"
      onMouseEnter={() => setHovered(layer.id)} onMouseLeave={() => setHovered(undefined)} onFocus={() => setHovered(layer.id)} onBlur={() => setHovered(undefined)}
      className="relative z-10 flex w-56 flex-col gap-1 rounded-md border bg-background px-2.5 py-2 text-left shadow-xs hover:border-foreground/30 data-[active=true]:border-ring data-[active=true]:ring-1 data-[active=true]:ring-ring">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 flex w-3.5 shrink-0 justify-center text-[11px] tabular-nums text-muted-foreground">{done ? <Check className="size-3.5 text-green-600 dark:text-green-400" aria-label="Reviewed" /> : i + 1}</span>
        <span className="line-clamp-2 text-xs font-medium leading-4">{layer.title}</span>
      </span>
      <span className="flex items-center gap-1.5 pl-5.5 text-[10px] text-muted-foreground"><CategoryPill category={layer.category} /><span className="shrink-0">{stat.paths.length} {stat.paths.length === 1 ? 'file' : 'files'}</span></span>
    </button>;
  };

  return <div className="p-4">
    <p className="mx-auto mb-4 max-w-5xl text-xs leading-5 text-muted-foreground">
      {analysis.groups?.length ? 'Boxes are independent areas of work. ' : ''}
      {hasEdges ? 'Arrows point from a layer to the layers that build on it.' : 'The model found no dependencies between layers.'} Point at a layer to highlight its links; click to open it.
    </p>
    <div ref={container} className="relative mx-auto flex max-w-5xl flex-col gap-6" data-testid="layer-map">
      <svg className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible" aria-hidden>
        <defs>{['muted-foreground', 'foreground'].map(color => <marker key={color} id={`layer-map-arrow-${color}`} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" style={{ fill: `var(--${color})` }} /></marker>)}</defs>
        {edges.map(edge => {
          // With a layer in focus, only its own links stay prominent so dense maps remain readable.
          const related = focus !== undefined && (edge.from === focus || edge.to === focus), faded = focus !== undefined && !related;
          return <path key={edge.id} d={edge.d} fill="none" markerEnd={`url(#layer-map-arrow-${related ? 'foreground' : 'muted-foreground'})`} strokeWidth={related ? 1.75 : 1.25}
            className={`transition-opacity ${related ? 'stroke-foreground' : 'stroke-muted-foreground/60'} ${faded ? 'opacity-15' : ''}`} />;
        })}
      </svg>
      {sections.map(section => {
        const rows = [...new Set(section.layers.map(l => depth.get(l.id)!))].sort((a, b) => a - b);
        return <section key={section.id} className={section.title ? 'rounded-lg border border-dashed px-3 pb-4 pt-2' : ''} aria-label={section.title || 'Layers'}>
          {section.title && <p className="mb-3 text-[11px] font-medium text-muted-foreground">{section.title}</p>}
          <div className="flex flex-col gap-9">{rows.map(row => <div key={row} className="flex flex-wrap justify-center gap-3">
            {section.layers.filter(l => depth.get(l.id) === row).map(node)}
          </div>)}</div>
        </section>;
      })}
    </div>
  </div>;
}
