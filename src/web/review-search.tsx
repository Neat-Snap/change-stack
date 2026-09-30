import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import { Input } from './components/ui/input';
import type { Session } from '../core/types';

export interface SearchResult { id: string; title: string; detail: string; path?: string; layer?: string; line?: number; side?: 'old' | 'current'; searchText?: string }
export function searchRecords(session: Session): SearchResult[] {
  const records: SearchResult[] = [];
  for (const layer of session.analysis.layers) records.push({ id: `layer:${layer.id}`, title: layer.title, detail: layer.summary, layer: layer.id });
  for (const file of session.review.files) {
    records.push({ id: `file:${file.path}`, title: file.path, detail: file.status, path: file.path });
    let old = 0, current = 0, inHunk = false;
    for (const text of file.patch.split('\n')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (match) { old = +match[1]; current = +match[2]; inHunk = true; continue; }
      if (!inHunk || ![' ', '+', '-'].includes(text[0])) continue;
      const side = text[0] === '-' ? 'old' : 'current', line = side === 'old' ? old : current;
      records.push({ id: `${file.path}:${side}:${line}`, title: `${file.path}:${line}`, detail: text.slice(1, 501), searchText: text.slice(1), path: file.path, line, side });
      if (text[0] !== '+') old++;
      if (text[0] !== '-') current++;
    }
  }
  return records;
}
export function ReviewSearch({ session, open, setOpen, choose }: { session: Session; open: boolean; setOpen: (open: boolean) => void; choose: (result: SearchResult) => void }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const records = useMemo(() => searchRecords(session), [session]);
  const results = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter(r => !words.length ? !r.line : words.every(word => `${r.title} ${r.searchText ?? r.detail}`.toLocaleLowerCase().includes(word))).slice(0, 100);
  }, [records, query]);
  function pick(result: SearchResult) { choose(result); setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent>
    <div className="px-4 pb-3 pt-4"><DialogTitle className="text-sm font-medium">Search changes</DialogTitle>
      <DialogDescription className="mt-1 text-xs text-muted-foreground">Paths, diff text and summaries · J/K layers · H/L files · U layout · [ sidebar</DialogDescription></div>
    <div className="relative mx-3 mb-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input autoFocus aria-label="Search changes" placeholder="Search…" value={query} className="pl-9" onChange={e => { setQuery(e.target.value); setSelected(0); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(results.length, 1); setSelected(next); document.getElementById(`review-result-${next}`)?.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter' && results[selected]) { e.preventDefault(); pick(results[selected]); }
      }} aria-controls="review-search-results" aria-activedescendant={results.length ? `review-result-${selected}` : undefined} /></div>
    <div id="review-search-results" className="min-h-0 overflow-auto border-t p-1" role="listbox" aria-label="Search results">
      {results.map((r, i) => <button id={`review-result-${i}`} role="option" aria-selected={selected === i} key={r.id} className={`flex w-full flex-col gap-1 rounded-sm px-3 py-2 text-left text-xs ${selected === i ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`} onClick={() => pick(r)} onMouseMove={() => setSelected(i)}>
        <span className="truncate font-medium">{r.title}</span><span className="line-clamp-2 break-all">{r.detail}</span></button>)}
      {!results.length && <p className="p-4 text-xs text-muted-foreground">No matches in the loaded review.</p>}
    </div><p className="border-t px-4 py-2 text-[11px] text-muted-foreground">↑ ↓ to move · Enter to open · Esc to close · Up to 100 results</p>
  </DialogContent></Dialog>;
}
