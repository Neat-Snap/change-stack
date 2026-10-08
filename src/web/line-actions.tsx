import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ExternalLink, MessageSquarePlus, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { findDiffRange, originDiffUrl, type LineRange } from '../core/changes';
import type { Review } from '../core/types';

// Wait until a selection has settled before offering actions, so reading and
// clicking through code never flashes a popover.
export const LINE_ACTIONS_DELAY_MS = 900;

export const OriginContext = createContext<{ review: Review; commentsEnabled: boolean } | undefined>(undefined);
export interface LineSelection extends LineRange { x: number; y: number }

export function LineActions({ path, selection, close, draft }: { path: string; selection: LineSelection; close: () => void; draft: React.RefObject<boolean> }) {
  const origin = useContext(OriginContext);
  const [composing, setComposing] = useState(false), [body, setBody] = useState('');
  const [posting, setPosting] = useState(false), [error, setError] = useState(''), [posted, setPosted] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  const postingRef = useRef(false);
  draft.current = !!body.trim() || posting;
  useEffect(() => () => { draft.current = false; }, [draft]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element?.parentElement) return;
    const parent = element.parentElement;
    const place = () => { element.style.left = `${Math.max(8, Math.min(selection.x, parent.clientWidth - element.offsetWidth - 8))}px`; };
    place();
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const observer = new ResizeObserver(place);
    observer.observe(parent); observer.observe(element);
    return () => observer.disconnect();
  }, [composing, selection]);
  useEffect(() => {
    // Leave a half-written comment open; otherwise any outside click dismisses.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focused = event.target instanceof Element ? event.target.closest('[data-testid="line-actions"]') : null;
      if (focused && focused !== box.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!postingRef.current) close();
    };
    const onDown = (event: PointerEvent) => { if (!body.trim() && !postingRef.current && !box.current?.contains(event.target as Node)) close(); };
    window.addEventListener('keydown', onKey, true); window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [close, body]);
  if (!origin) return null;
  const file = origin.review.files.find(f => f.path === path);
  if (!file) return null;
  const service = origin.review.target.provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const located = findDiffRange(file, selection), range = located?.range ?? selection;
  const inDiff = !!located;
  const pointLabel = (line: number, side: LineRange['side']) => `${side === 'old' ? 'old ' : ''}${line}`;
  const label = range.start === range.end && range.side === (range.endSide ?? range.side)
    ? `line ${pointLabel(range.start, range.side)}`
    : `lines ${pointLabel(range.start, range.side)}–${pointLabel(range.end, range.endSide ?? range.side)}`;
  async function submit() {
    if (!body.trim() || postingRef.current) return;
    postingRef.current = true;
    // Keep Escape owned by this composer while its form controls are disabled.
    box.current?.focus();
    setPosting(true); setError('');
    try {
      const response = await fetch('/api/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, ...range, body }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not post the comment.');
      setPosted(value.url); setBody(''); setComposing(false);
    } catch (error) { setError((error as Error).message); }
    finally { postingRef.current = false; setPosting(false); }
  }
  return <div ref={box} role="dialog" tabIndex={-1} aria-label={`Actions for ${label}`} data-testid="line-actions"
    className="absolute z-30 animate-in fade-in-0 zoom-in-95 rounded-md border bg-popover font-sans text-xs text-popover-foreground shadow-md outline-none"
    style={{ left: selection.x, top: selection.y, width: composing ? 'min(26rem, calc(100% - 1rem))' : undefined, maxWidth: 'calc(100% - 1rem)' }}
    onPointerDown={event => event.stopPropagation()}>
    {!composing && <div className="flex items-center gap-0.5 p-0.5">
      <a href={originDiffUrl(origin.review, file, inDiff ? range : undefined)} target="_blank" rel="noopener noreferrer"
        className="flex h-7 items-center gap-1.5 rounded-sm px-2 hover:bg-accent" title={inDiff ? `Open ${label} in ${service}` : `This line is outside the ${service} diff; opens the file`}>
        <ExternalLink className="size-3.5 text-muted-foreground" />Open in {service}</a>
      {origin.commentsEnabled && located?.sameHunk && !posted && <button className="flex h-7 items-center gap-1.5 rounded-sm px-2 hover:bg-accent" onClick={() => setComposing(true)}>
        <MessageSquarePlus className="size-3.5 text-muted-foreground" />Comment</button>}
      {posted && <a href={posted} target="_blank" rel="noopener noreferrer" className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-green-700 hover:bg-accent dark:text-green-400">
        <Check className="size-3.5" />Posted · view</a>}
    </div>}
    {composing && <form className="flex flex-col gap-2 p-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="flex items-center gap-2 text-muted-foreground"><span className="min-w-0 flex-1 truncate font-mono text-[11px]">{path} · {label}</span>
        <button type="button" aria-label="Cancel comment" disabled={posting} className="rounded-sm p-0.5 hover:bg-accent disabled:opacity-50" onClick={() => { setComposing(false); setBody(''); setError(''); }}><X className="size-3.5" /></button></div>
      <textarea autoFocus value={body} disabled={posting} onChange={event => setBody(event.target.value)} rows={4} maxLength={20_000} placeholder={`Comment on ${service}… (Markdown)`} aria-label="Comment"
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && body.trim() && !posting) { event.preventDefault(); void submit(); } }}
        className="min-h-20 w-full resize-y rounded-sm border bg-background px-2 py-1.5 text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">Posts immediately as you · ⌘/Ctrl+Enter</span>
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={!body.trim() || posting}>{posting ? 'Posting…' : `Post to ${service}`}</Button></div>
    </form>}
  </div>;
}
