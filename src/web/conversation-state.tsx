import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Conversation } from '../core/types';

export const CONVERSATION_REFRESH_MS = 5 * 60 * 1000;
interface ConversationState {
  enabled: boolean;
  conversation?: Conversation;
  loading: boolean;
  error: string;
  refresh(): Promise<void>;
  refreshAfterWrite(): Promise<void>;
  draft(id: string): string;
  setDraft(id: string, text: string): void;
  act(action: 'reply' | 'resolve' | 'comment', body: unknown): Promise<void>;
}
const Context = createContext<ConversationState>({ enabled: false, loading: false, error: '', refresh: async () => {}, refreshAfterWrite: async () => {}, draft: () => '', setDraft: () => {}, act: async () => {} });
export const useConversation = () => useContext(Context);

export function ConversationProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [conversation, setConversation] = useState<Conversation>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const pending = useRef<Promise<void>>(undefined), mounted = useRef(true);
  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    if (pending.current) return pending.current;
    setLoading(true);
    return pending.current = (async () => {
      try {
        const response = await fetch('/api/conversation');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not refresh the conversation.');
        if (mounted.current) { setConversation(data); setError(''); }
      } catch (error) { if (mounted.current) setError((error as Error).message); }
      finally { pending.current = undefined; if (mounted.current) setLoading(false); }
    })();
  }, [enabled]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, CONVERSATION_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { mounted.current = false; clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  const refreshAfterWrite = useCallback(async () => {
    if (pending.current) await pending.current;
    await refresh();
  }, [refresh]);
  const act = useCallback(async (action: 'reply' | 'resolve' | 'comment', body: unknown) => {
    const response = await fetch(`/api/conversation/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not update the conversation.');
    // Finish any earlier read, then fetch after this confirmed write.
    await refreshAfterWrite();
  }, [refreshAfterWrite]);
  return <Context.Provider value={{ enabled, conversation, loading, error, refresh, refreshAfterWrite, act, draft: id => drafts[id] ?? '',
    setDraft: (id, text) => setDrafts(previous => { const next = { ...previous }; if (text) next[id] = text; else delete next[id]; return next; }) }}>{children}</Context.Provider>;
}
