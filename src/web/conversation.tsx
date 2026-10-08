import React, { useState } from 'react';
import { Check, CheckCheck, ChevronDown, ChevronRight, ExternalLink, MessageCircle, MessageSquare, RefreshCw, Reply, RotateCcw, ArrowLeft } from 'lucide-react';
import { Button } from './components/ui/button';
import { Summary } from './summary';
import { useConversation } from './conversation-state';
import type { Layer, Review, ReviewThread, ThreadComment } from '../core/types';
import { ThreadCodeContext } from './thread-context';

function Avatar({ author, small = false }: { author: string; small?: boolean }) {
  const colors = ['bg-blue-500/15 text-blue-600 dark:text-blue-300', 'bg-violet-500/15 text-violet-600 dark:text-violet-300', 'bg-amber-500/15 text-amber-700 dark:text-amber-300', 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'];
  const color = colors[[...author].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % colors.length];
  return <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${small ? 'size-5' : 'size-7'} ${color}`}>{author.slice(0, 2).toUpperCase()}</span>;
}
function timeLabel(date: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  return seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function Comment({ comment }: { comment: ThreadComment }) {
  const [full, setFull] = useState(false);
  const long = comment.body.length > 900;
  return <div className="flex gap-2.5 px-3 py-3" data-testid="thread-comment">
    <Avatar author={comment.author} />
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-2 font-sans text-xs">
        <span className="font-semibold text-foreground">{comment.author}</span>
        <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="text-[11px] text-muted-foreground">{timeLabel(comment.createdAt)}</time>
        <a href={comment.url} target="_blank" rel="noopener noreferrer" aria-label={`Open comment by ${comment.author}`} className="ml-auto text-muted-foreground hover:text-foreground"><ExternalLink className="size-3" /></a>
      </div>
      <div className={`thread-markdown ${long && !full ? 'max-h-40 overflow-hidden [mask-image:linear-gradient(black_70%,transparent)]' : ''}`}><Summary text={comment.body} /></div>
      {long && <button className="mt-1 font-sans text-xs font-medium text-blue-600 hover:underline dark:text-blue-400" onClick={() => setFull(value => !value)}>{full ? 'Show less' : 'Read full comment'}</button>}
    </div>
  </div>;
}

export function ThreadCard({ thread, inline = false, context }: { thread: ReviewThread; inline?: boolean; context?: React.ReactNode }) {
  const conversation = useConversation();
  const [expanded, setExpanded] = useState<boolean>(), [allReplies, setAllReplies] = useState(false), [replying, setReplying] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const draft = conversation.draft(thread.id);
  const open = expanded ?? !thread.resolved;
  const first = thread.comments[0];
  const comments = allReplies || thread.comments.length <= 4 ? thread.comments : [first, ...thread.comments.slice(-2)];
  async function resolve() {
    if (pending) return;
    setPending(true); setError('');
    try { await conversation.act('resolve', { threadId: thread.id, resolved: !thread.resolved }); setExpanded(thread.resolved); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  async function reply() {
    if (!draft.trim() || pending) return;
    setPending(true); setError('');
    try { await conversation.act('reply', { threadId: thread.id, body: draft }); conversation.setDraft(thread.id, ''); setReplying(false); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <article data-testid="review-thread" data-thread-id={thread.id} data-resolved={thread.resolved} className={`min-w-0 overflow-hidden rounded-md border font-sans text-foreground ${thread.resolved ? 'border-border bg-background' : 'border-blue-500/25 bg-background'} ${inline ? 'mx-3 my-2 shadow-sm' : ''}`}>
    {context}
    <div className={`flex min-h-9 items-center gap-2 px-3 py-1.5 text-xs ${context ? 'border-t' : ''} ${thread.resolved ? 'bg-sidebar/70' : 'bg-blue-500/5'}`}>
      <button onClick={() => setExpanded(!open)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} thread by ${first.author}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
        {thread.resolved ? <CheckCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-400" /> : thread.kind === 'diff' ? <MessageCircle className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" /> : <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="shrink-0 font-medium">{thread.resolved ? 'Resolved' : thread.kind === 'diff' ? 'Open thread' : thread.kind === 'review' ? thread.reviewState === 'APPROVED' ? 'Approved' : thread.reviewState === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Review' : 'Discussion'}</span>
        {!open && <><span className="text-muted-foreground">·</span><span className="truncate text-muted-foreground">{first.body.replace(/[`*_~]/g, '').replace(/\s+/g, ' ').slice(0, 110)}</span></>}
        {thread.outdated && <span className="shrink-0 rounded border px-1 py-0.5 text-[10px] text-muted-foreground">Outdated</span>}
      </button>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={`${thread.comments.length} comments`}>{thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}</span>
    </div>
    {open && <>
      <div className="divide-y border-t">
        {comments.map((comment, index) => <React.Fragment key={comment.id}>
          {index === 1 && !allReplies && thread.comments.length > 4 && <button onClick={() => setAllReplies(true)} className="flex w-full items-center justify-center gap-2 bg-sidebar/40 py-2.5 text-xs text-muted-foreground hover:bg-accent"><MessageCircle className="size-3.5" />Show {thread.comments.length - 3} earlier replies</button>}
          <Comment comment={comment} />
        </React.Fragment>)}
      </div>
      <div className="border-t bg-sidebar/30 px-3 py-2">
        {!replying && !draft ? <div className="flex flex-wrap items-center gap-2">
          {thread.canReply && <Button variant="ghost" size="xs" onClick={() => setReplying(true)}><Reply className="size-3.5" />Reply</Button>}
          {thread.resolvable && <Button variant="ghost" size="xs" disabled={pending || !thread.canResolve} title={!thread.canResolve ? 'Your account cannot change this thread’s resolution' : undefined} onClick={() => void resolve()}>
            {thread.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}{pending ? 'Updating…' : thread.resolved ? 'Reopen thread' : 'Resolve thread'}</Button>}
          {thread.resolvedBy && <span className="ml-auto text-[11px] text-muted-foreground">Resolved by {thread.resolvedBy}</span>}
          {!thread.canReply && <span className="text-[11px] text-muted-foreground">Continue this discussion in the original review.</span>}
        </div> : <form onSubmit={event => { event.preventDefault(); void reply(); }} className="space-y-2">
          <textarea autoFocus aria-label={`Reply to ${first.author}`} placeholder="Write a reply… Markdown supported" value={draft} disabled={pending} maxLength={20_000} rows={3}
            onChange={event => conversation.setDraft(thread.id, event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void reply(); } }}
            className="w-full resize-y rounded border bg-background px-2.5 py-2 text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          <div className="flex items-center gap-2"><Button size="xs" type="submit" disabled={pending || !draft.trim()}>{pending ? 'Posting…' : 'Reply'}</Button>
            <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => { setReplying(false); conversation.setDraft(thread.id, ''); setError(''); }}>Cancel</Button>
            <span className="ml-auto text-[10px] text-muted-foreground">⌘/Ctrl+Enter</span></div>
        </form>}
        {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </>}
    {!open && error && <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">{error}</p>}
  </article>;
}

export function ConversationView({ close, jump, review, layers, service }: {
  close: () => void; review: Review; layers: Layer[]; service: string;
  jump: (thread: ReviewThread, destination?: { layerId: string; line: number; side: 'old' | 'current' }) => void;
}) {
  const state = useConversation();
  const threads = state.conversation?.threads ?? [];
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'discussion'>('all');
  const [composing, setComposing] = useState(false), [posting, setPosting] = useState(false), [error, setError] = useState('');
  const draft = state.draft('new-discussion');
  const open = threads.filter(t => t.kind === 'diff' && !t.resolved).length, resolved = threads.filter(t => t.resolved).length;
  const filtered = threads.filter(t => filter === 'all' || (filter === 'open' ? t.kind === 'diff' && !t.resolved : filter === 'resolved' ? t.resolved : t.kind !== 'diff'));
  async function post() {
    if (!draft.trim() || posting) return;
    setPosting(true); setError('');
    try { await state.act('comment', { body: draft }); state.setDraft('new-discussion', ''); setComposing(false); }
    catch (error) { setError((error as Error).message); }
    finally { setPosting(false); }
  }
  return <section className="absolute inset-0 z-20 flex flex-col bg-background" aria-label="Conversation" data-testid="conversation-view">
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4"><MessageSquare className="size-4 text-muted-foreground" /><span className="flex-1 text-[13px] font-semibold">Conversation</span>
      <Button size="xs" variant="ghost" onClick={close}><ArrowLeft className="size-3.5" />Back to changes</Button></div>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold">Review conversation</h1>
          <p className="mt-1 text-xs text-muted-foreground">{open} open {open === 1 ? 'thread' : 'threads'} · {resolved} resolved · {threads.reduce((n, t) => n + t.comments.length, 0)} comments</p></div>
          <Button size="sm" variant="outline" disabled={state.loading} onClick={() => void state.refresh()}><RefreshCw className={`size-3.5 ${state.loading ? 'animate-spin' : ''}`} />{state.loading ? 'Refreshing…' : 'Refresh'}</Button></div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${state.error ? 'bg-amber-500' : 'bg-green-500'}`} />Refreshes every 5 minutes{state.conversation && ` · Updated ${timeLabel(state.conversation.fetchedAt)}`}</p>
        {state.error && <p role="alert" className="mt-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{state.error}</p>}
        {state.conversation?.reviewChanged && <p role="note" className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">This review has new commits. Reopen it from your terminal to update the diff. Conversations stay current here.</p>}
        <div className="mb-4 mt-5 flex flex-wrap gap-1 border-b" role="tablist" aria-label="Conversation filter">
          {(['all', 'open', 'resolved', 'discussion'] as const).map(value => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
            className={`border-b-2 px-3 py-2 text-xs ${filter === value ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {value === 'all' ? 'All' : value === 'open' ? `Open ${open}` : value === 'resolved' ? `Resolved ${resolved}` : 'Discussion'}</button>)}
        </div>
        <div className="space-y-4">{filtered.map(thread => <ThreadCard key={thread.id} thread={thread} context={thread.kind === 'diff' ? <ThreadCodeContext review={review} layers={layers} thread={thread} jump={jump} /> : undefined} />)}</div>
        {!filtered.length && <div className="rounded-md border border-dashed px-5 py-10 text-center"><MessageCircle className="mx-auto mb-2 size-6 text-muted-foreground" /><p className="text-sm font-medium">{state.loading && !state.conversation ? 'Loading conversation…' : 'No conversations here yet'}</p><p className="mt-1 text-xs text-muted-foreground">{filter === 'open' ? 'All review threads are resolved.' : 'Start a discussion or select a line in the diff to comment.'}</p></div>}
        <div className="mt-5">
          {!composing && !draft ? <Button variant="outline" size="sm" onClick={() => setComposing(true)}><MessageSquare className="size-3.5" />New discussion</Button> : <form onSubmit={event => { event.preventDefault(); void post(); }} className="rounded-md border bg-sidebar/30 p-3">
            <p className="mb-2 text-xs font-medium">Start a discussion</p>
            <textarea autoFocus aria-label="New discussion" value={draft} onChange={event => state.setDraft('new-discussion', event.target.value)} disabled={posting} maxLength={20_000} rows={4} placeholder="Share a review note… Markdown supported"
              onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void post(); } }} className="w-full resize-y rounded border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            {error && <p role="alert" className="my-2 text-xs text-destructive">{error}</p>}
            <div className="mt-2 flex items-center gap-2"><Button size="xs" disabled={posting || !draft.trim()}>{posting ? 'Posting…' : `Post to ${service}`}</Button><Button type="button" variant="ghost" size="xs" disabled={posting} onClick={() => { setComposing(false); state.setDraft('new-discussion', ''); }}>Cancel</Button></div>
          </form>}
        </div>
      </div>
    </div>
  </section>;
}
