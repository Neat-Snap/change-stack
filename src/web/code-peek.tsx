import React, { useState } from 'react';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import type { SymbolResult } from '../core/review-tools';
export interface PeekState { symbol: string; loading?: boolean; error?: string; result?: SymbolResult }
export function CodePeek({ state, close, jump, lookup, canJump }: { state?: PeekState; close: () => void; jump: (path: string, line: number) => void; lookup: (symbol: string) => void; canJump: (path: string) => boolean }) {
  const [query, setQuery] = useState('');
  return <Dialog open={!!state} onOpenChange={open => { if (!open) close(); }}><DialogContent>
    <div className="px-4 pb-3 pt-4"><DialogTitle className="text-sm font-medium">{state?.symbol || 'Look up symbol'}</DialogTitle>
      <DialogDescription className="mt-1 pr-5 text-xs text-muted-foreground">Definitions and references at the PR head. Bounded text lookup; results may be incomplete.</DialogDescription></div>
    {!state?.symbol && <form className="flex gap-2 border-t p-3" onSubmit={e => { e.preventDefault(); lookup(query); }}><Input autoFocus aria-label="Symbol name" placeholder="Function, type or variable…" value={query} onChange={e => setQuery(e.target.value)} /><Button type="submit" disabled={!/^[A-Za-z_$][\w$]{1,79}$/.test(query)}>Look up</Button></form>}
    <div className="min-h-0 overflow-auto border-t">
      {state?.loading && <p className="p-4 text-sm text-muted-foreground">Looking up symbol…</p>}
      {state?.error && <p className="p-4 text-sm text-muted-foreground">{state.error}</p>}
      {state?.result && <><p className="border-b px-4 py-2 text-xs text-muted-foreground">{state.result.scanned} files searched · {state.result.unavailable} unavailable · {state.result.limited ? 'Search limit reached' : 'Changed files and nearby directories'}</p>
        {!state.result.matches.length && <p className="p-4 text-sm text-muted-foreground">No matches in the searched files.</p>}
        {state.result.matches.map((match, i) => <div key={i} className="border-b p-3">
          <button disabled={!canJump(match.path)} className="mb-2 text-left text-xs enabled:hover:underline" onClick={() => jump(match.path, match.line)}>{match.path}:{match.line} <span className="text-muted-foreground">· {match.kind}</span></button>
          <pre className="overflow-auto font-mono text-xs leading-5">{match.snippet.split('\n').map((line, j) => <div key={j} className={match.startLine + j === match.line ? 'bg-accent text-foreground' : 'text-muted-foreground'}><span className="mr-3 inline-block w-7 select-none text-right opacity-60">{match.startLine + j}</span>{line}</div>)}</pre>
        </div>)}</>}
    </div>
  </DialogContent></Dialog>;
}
