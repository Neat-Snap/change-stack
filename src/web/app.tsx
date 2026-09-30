import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Virtualizer } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { ChevronLeft, ChevronRight, Columns2, Rows2, Sun, Moon, Files, TriangleAlert, Search, SearchCode, Keyboard } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { themes, type ReviewTheme } from './themes';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ReviewSearch, type SearchResult } from './review-search';
import { ReviewPatch, readApi, patchLineOffset, type LineTarget } from './review-patch';
import { CodePeek, type PeekState } from './code-peek';
import type { SymbolResult } from '../core/review-tools';
import { layerFile } from '../core/changes';
import { Shortcuts } from './shortcuts';
import { Summary } from './summary';
import type { ChangedFile, Session } from '../core/types';
import './generated.css';

async function loadSession(): Promise<Session> {
  const token = new URLSearchParams(location.hash.slice(1)).get('session');
  if (token) {
    history.replaceState(null, '', location.pathname);
    const response = await fetch('/api/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Session expired. Open the latest link from your terminal.');
  }
  const response = await fetch('/api/review');
  if (!response.ok) throw new Error('Open the review link printed in your terminal.');
  return response.json();
}

function Tree({ files, select }: { files: ChangedFile[]; select: (path: string) => void }) {
  const { model } = useFileTree({
    paths: files.map(file => file.path),
    initialExpandedPaths: [...new Set(files.flatMap(file => file.path.split('/').slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join('/'))))],
    onSelectionChange: paths => {
      const path = paths.at(-1);
      if (path && files.some(file => file.path === path)) select(path);
    },
    icons: { set: 'complete' },
    gitStatus: files.map(file => ({ path: file.path, status: file.status })),
  });
  return <FileTree model={model} className="file-tree" style={{ height: '100%' }} onClick={event => {
    // A selected file can be clicked again after the reviewer scrolls elsewhere.
    const row = event.nativeEvent.composedPath().find(node => node instanceof HTMLElement && node.dataset.itemPath) as HTMLElement | undefined;
    const path = row?.dataset.itemPath;
    if (path && files.some(file => file.path === path)) select(path);
  }} />;
}

class DiffBoundary extends Component<{ children: React.ReactNode; patch: string }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="p-4"><p className="mb-3 text-sm text-muted-foreground">Unable to render this patch.</p>
      <pre className="overflow-auto font-mono text-xs leading-6">{this.props.patch}</pre></div>;
  }
}

function ReviewWorkspace({ session }: { session: Session }) {
  const { review, analysis } = session;
  const [activeLayer, setActiveLayer] = useState<string>(analysis.layers[0]?.id ?? 'all');
  const sections = useRef(new Map<string, HTMLElement>());
  const summary = useRef<HTMLDivElement>(null);
  const [reviewed, setReviewed] = useState(() => new Set<string>());
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [layersOpen, setLayersOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const activeLayerIndex = analysis.layers.findIndex(layer => layer.id === activeLayer);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const { isMobile, setOpenMobile, setOpen, open, openMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [peek, setPeek] = useState<PeekState>();
  const lookupPath = useRef(''), lookupSerial = useRef(0);
  const [target, setTarget] = useState<LineTarget>();
  const pendingJump = useRef<{ path: string; line?: number; side?: 'old' | 'current' } | undefined>(undefined);
  const layer = analysis.layers.find(layer => layer.id === activeLayer);
  const files = useMemo(() => review.files.filter(file => !layer || layer.files.includes(file.path)).map(file => layer?.ranges && file.patch ? layerFile(file, layer.ranges) : file), [review.files, layer]);
  const warnings = [...review.warnings, ...analysis.warnings];
  const [theme, setTheme] = useState<ReviewTheme>(() => {
    try { const saved = localStorage.getItem('change-stack.theme'); if (saved && Object.hasOwn(themes, saved)) return saved as ReviewTheme; } catch { /* Storage can be unavailable. */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light';
  });
  const dark = theme.endsWith('dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('change-stack.theme', theme); } catch { /* Theme remains usable without storage. */ }
  }, [theme, dark]);
  useEffect(() => { document.title = `${review.target.project} #${review.target.number}`; }, [review]);

  function chooseLayer(id: string) {
    setActiveLayer(id);
    requestAnimationFrame(() => summary.current?.scrollIntoView({ block: 'start' }));
    if (isMobile) setOpenMobile(false);
  }
  function chooseFile(path: string) {
    pendingJump.current = { path };
    performJump();
    if (isMobile) setOpenMobile(false);
  }

  function performJump() {
    requestAnimationFrame(() => {
      const jump = pendingJump.current;
      if (!jump) return;
      const section = sections.current.get(jump.path);
      if (!section) return;
      const pane = section.closest('.diff-viewport') as HTMLElement;
      const file = (jump.line ? review.files : files).find(f => f.path === jump.path);
      const top = pane.scrollTop + section.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTop = top + (jump.line && file ? 40 + patchLineOffset(file.patch, jump.line, jump.side ?? 'current', layout) : 0);
      if (jump.line) requestAnimationFrame(() => requestAnimationFrame(() => {
        const root = section.querySelector('diffs-container')?.shadowRoot;
        const column = jump.side === 'old' ? 'deletions' : 'additions';
        const row = root?.querySelector(`[data-code-column="${column}"] [data-line="${jump.line}"]`) ?? root?.querySelector(`[data-line="${jump.line}"]`);
        row?.scrollIntoView({ block: 'center' });
      }));
      pendingJump.current = undefined;
    });
  }
  useEffect(() => { if (pendingJump.current) performJump(); }, [activeLayer, collapsed]);
  function jumpAnywhere(path: string, line?: number, side: 'old' | 'current' = 'current') {
    setActiveLayer('all');
    setFileCollapsed(path, false);
    pendingJump.current = { path, line, side };
    setTarget(line ? { path, line, side, serial: Date.now() } : undefined);
    if (isMobile) setOpenMobile(false);
    performJump();
  }
  function chooseResult(result: SearchResult) { if (result.layer) chooseLayer(result.layer); else if (result.path) jumpAnywhere(result.path, result.line, result.side); }
  async function lookupSymbol(symbol: string, path: string) {
    const serial = ++lookupSerial.current; lookupPath.current = path;
    setPeek({ symbol, loading: true });
    try { const result = await readApi<SymbolResult>('/api/symbol', { path, symbol }); if (serial === lookupSerial.current) setPeek({ symbol, result }); }
    catch (error) { if (serial === lookupSerial.current) setPeek({ symbol, error: (error as Error).message }); }
  }
  function closePeek() { lookupSerial.current++; setPeek(undefined); }
  function moveFile(direction: number) {
    const pane = document.querySelector('.diff-viewport')!;
    const at = files.findIndex(f => (sections.current.get(f.path)?.getBoundingClientRect().bottom ?? 0) > pane.getBoundingClientRect().top + 48);
    const next = Math.max(0, Math.min(files.length - 1, at + direction));
    if (files[next]) chooseFile(files[next].path);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.composedPath().some(e => e instanceof HTMLElement && (e.matches('input,textarea,select,[role="combobox"]') || e.isContentEditable));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!peek && !shortcutsOpen) setSearchOpen(open => !open); return; }
      if (typing || searchOpen || peek || shortcutsOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/' || event.key === '?') { event.preventDefault(); setSearchOpen(true); }
      else if (event.key === 'j' && activeLayerIndex < analysis.layers.length - 1) { event.preventDefault(); chooseLayer(analysis.layers[activeLayerIndex + 1].id); }
      else if (event.key === 'k' && activeLayerIndex > 0) { event.preventDefault(); chooseLayer(analysis.layers[activeLayerIndex - 1].id); }
      else if (event.key === 'l' || event.key === 'h') { event.preventDefault(); moveFile(event.key === 'l' ? 1 : -1); }
      else if (event.key === 'u') { event.preventDefault(); setLayout(value => value === 'split' ? 'unified' : 'split'); }
      else if (event.key === '[') { event.preventDefault(); if (isMobile) setOpenMobile(!openMobile); else setOpen(!open); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [files, activeLayerIndex, searchOpen, peek, shortcutsOpen, isMobile, open, openMobile]);

  function setFileCollapsed(path: string, value: boolean) {
    setCollapsed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
  }
  function markReviewed(path: string, value: boolean) {
    setReviewed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
    setFileCollapsed(path, value);
  }

  return <>
    <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <ReviewSearch session={session} open={searchOpen} setOpen={setSearchOpen} choose={chooseResult} />
    <CodePeek state={peek} close={closePeek} lookup={symbol => void lookupSymbol(symbol, lookupPath.current)} canJump={path => review.files.some(f => f.path === path)} jump={(path, line) => { closePeek(); jumpAnywhere(path, line); }} />
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader className="px-3 pb-2 pt-4">
        <SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton isActive={activeLayer === 'all'} onClick={() => chooseLayer('all')} className="h-9">
            <Files className="size-4" /><span>All changes</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{review.files.length}</span>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden!">
        <Collapsible open={layersOpen} onOpenChange={setLayersOpen}
          className={`flex min-h-0 flex-col ${layersOpen ? treeOpen ? 'max-h-[45%] flex-[0_1_45%]' : 'flex-1' : 'shrink-0'}`}>
          <div className="relative z-10 shrink-0 border-y bg-sidebar">
            <CollapsibleTrigger className="flex h-9 w-full items-center justify-between px-4 text-left text-foreground hover:bg-sidebar-accent" aria-label="Layers">
              <span className="font-sans text-[13px] font-medium">Layers</span>
              <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${layersOpen ? 'rotate-90' : ''}`} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden" data-testid="layers-panel">
            <ScrollArea className="h-full rounded-none" data-testid="layers-scroll">
              <SidebarGroup className="px-3 pb-3 pt-2">
                <SidebarGroupContent><SidebarMenu className="gap-1" aria-label="Review layers">
                  {analysis.layers.map((layer, index) => <SidebarMenuItem key={layer.id}>
                    <SidebarMenuButton isActive={activeLayer === layer.id} onClick={() => chooseLayer(layer.id)}
                      className="h-auto min-h-10 items-start gap-3 py-2.5" data-testid="layer-button">
                      <span className="mt-0.5 w-3 shrink-0 text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="whitespace-normal! overflow-visible! text-[13px] leading-5">{layer.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>)}
                </SidebarMenu></SidebarGroupContent>
              </SidebarGroup>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible open={treeOpen} onOpenChange={setTreeOpen} className={`flex min-h-0 flex-col ${treeOpen ? 'flex-1' : 'shrink-0'}`}>
          <div className={`relative z-10 shrink-0 bg-sidebar ${layersOpen ? "border-y" : "border-b"}`}>
            <CollapsibleTrigger className="flex h-9 w-full items-center justify-between px-4 text-left text-foreground hover:bg-sidebar-accent" aria-label={treeOpen ? 'Collapse file tree' : 'Expand file tree'}>
              <span className="font-sans text-[13px] font-medium">Files</span>
              <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${treeOpen ? 'rotate-90' : ''}`} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-1" data-testid="tree-panel">
            <Tree key={activeLayer} files={files} select={chooseFile} />
          </CollapsibleContent>
        </Collapsible>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="h-svh min-w-0 overflow-hidden">
      <header data-review-toolbar className="flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-5">
        <SidebarTrigger className="-ml-1 size-7 text-muted-foreground" />
        <Separator orientation="vertical" className="!h-4" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{layer?.title ?? 'All changes'}</span>
        <div className="flex shrink-0 items-center gap-0.5" aria-label="Layer navigation">
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Previous layer"
            disabled={activeLayerIndex <= 0} onClick={() => chooseLayer(analysis.layers[activeLayerIndex - 1]!.id)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Next layer"
            disabled={!analysis.layers.length || activeLayerIndex >= analysis.layers.length - 1}
            onClick={() => chooseLayer(analysis.layers[activeLayerIndex + 1]!.id)}><ChevronRight className="size-3.5" /></Button>
        </div>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Search changes" title="Search (⌘/Ctrl K)" onClick={() => setSearchOpen(true)}><Search className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard className="size-4" /></Button>
        <Select value={theme} onValueChange={value => setTheme(value as ReviewTheme)}>
          <SelectTrigger aria-label="Theme" title="Theme" className="h-7! w-7! justify-center border-0 bg-transparent! p-0 shadow-none [&>svg:last-child]:hidden">{dark ? <Moon className="size-4" /> : <Sun className="size-4" />}<span className="sr-only"><SelectValue /></span></SelectTrigger>
          <SelectContent>{Object.entries(themes).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Tabs value={layout} onValueChange={value => setLayout(value as 'split' | 'unified')}>
          <TabsList className="h-7 gap-0.5 bg-transparent p-0"><TabsTrigger value="split" aria-label="Split" title="Split diff" className="h-7! w-7! flex-none rounded-sm p-0 shadow-none! data-[state=active]:bg-accent"><Columns2 className="size-3.5" /></TabsTrigger>
            <TabsTrigger value="unified" aria-label="Unified" title="Unified diff" className="h-7! w-7! flex-none rounded-sm p-0 shadow-none! data-[state=active]:bg-accent"><Rows2 className="size-3.5" /></TabsTrigger></TabsList>
        </Tabs>
      </header>
      <div className="min-h-0 flex-1" data-testid="diff-scroll" style={{ '--change-stack-split-left': `${splitRatio}%` } as React.CSSProperties}>
        <Virtualizer className="diff-viewport h-full overflow-auto" config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }} contentClassName="pb-4">
          <div ref={summary} className="m-3 scroll-mt-3 rounded-md border bg-sidebar/40 p-3" data-testid={layer ? 'layer-summary' : 'pr-summary'}>
            <Summary text={layer?.summary ?? analysis.summary} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground"><p data-testid="diff-scope">{layer?.ranges ? 'Original Git diff · only changes assigned to this layer' : layer ? 'Original Git diff · all changes in these files' : 'Original Git diff · all PR changes'}</p>
              {!layer && <span data-testid="pr-statistics" className="flex flex-wrap items-center gap-3 tabular-nums">
                <span>{review.files.length} files</span><span className="text-green-600 dark:text-green-400">+{review.files.reduce((n, f) => n + f.additions, 0)} lines</span><span className="text-red-600 dark:text-red-400">−{review.files.reduce((n, f) => n + f.deletions, 0)} lines</span><span>{analysis.layers.length} layers</span>
              </span>}
            </div>
          </div>
          {warnings.map((warning, index) => <Alert key={index} className="mx-3 mb-3 w-auto text-muted-foreground"><TriangleAlert className="size-4" />
            <AlertDescription>{warning}</AlertDescription></Alert>)}
          {files.map(file => {
            const original = review.files.find(f => f.path === file.path)!;
            const partial = !!layer?.ranges && (file.additions !== original.additions || file.deletions !== original.deletions);
            const otherLayers = analysis.layers.filter(l => l.id !== layer?.id && l.files.includes(file.path)).length;
            const scope = layer?.ranges ? <>
              <span data-testid="file-scope">{partial ? `Layer: +${file.additions} −${file.deletions} · Whole file: +${original.additions} −${original.deletions}${otherLayers ? ` · Also changed in ${otherLayers} other ${otherLayers === 1 ? 'layer' : 'layers'}` : ''}` : 'All file edits in this layer'}</span>
              {partial && <Button variant="link" className="h-auto p-0 text-xs" onClick={() => jumpAnywhere(file.path)}>View all file changes</Button>}
            </> : undefined;
            return <section ref={element => { if (element) sections.current.set(file.path, element); else sections.current.delete(file.path); }} key={file.path} aria-label={file.path} className="diff-container scroll-mt-0 border-b bg-background" data-testid="file-diff">
            <Collapsible open={!collapsed.has(file.path)} onOpenChange={open => setFileCollapsed(file.path, !open)}>
              <div className="sticky top-0 z-10 flex min-h-10 items-center gap-3 bg-sidebar px-3">
                <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-xs" aria-label={`${collapsed.has(file.path) ? 'Expand' : 'Collapse'} ${file.path}`}>
                  <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed.has(file.path) ? '' : 'rotate-90'}`} />
                  <span className="truncate font-mono">{file.path}</span>
                </CollapsibleTrigger>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={`Look up symbol ${file.path}`} title="Look up symbol (or Alt-click a code token)" onClick={() => { lookupPath.current = file.path; setPeek({ symbol: '' }); }}><SearchCode className="size-4" /></Button>
                <span className="hidden shrink-0 font-mono text-[11px] tabular-nums sm:inline"><span className="text-green-600 dark:text-green-400">+{file.additions}</span> <span className="text-red-600 dark:text-red-400">−{file.deletions}</span></span>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={reviewed.has(file.path)} onCheckedChange={checked => markReviewed(file.path, checked === true)} aria-label={`Mark ${file.path} as reviewed`} />
                  <span className="hidden sm:inline">Reviewed</span>
                </label>
              </div>
              <CollapsibleContent className="border-t" data-testid="file-diff-content">
            {file.incomplete && <div className="border-b px-4 py-3 text-xs text-muted-foreground">{file.path}: this patch is incomplete.</div>}
            {file.patch ? <DiffBoundary key={file.path} patch={file.patch}>
              <ReviewPatch key={`${activeLayer}:${file.path}`} file={review.files.find(f => f.path === file.path)!} ranges={layer?.ranges} theme={theme} layout={layout}
                scope={scope} splitRatio={splitRatio} onSplitRatioChange={setSplitRatio} contextAvailable={!!review.baseSha} lookup={(symbol, path) => void lookupSymbol(symbol, path)} target={target} />
            </DiffBoundary> : <div className="p-4 text-sm text-muted-foreground">{scope}{file.path} · No text patch available.</div>}
              </CollapsibleContent>
            </Collapsible>
          </section>; })}
          {!files.length && <p className="p-5 text-sm text-muted-foreground">No changes to display.</p>}
        </Virtualizer>
      </div>
    </SidebarInset>
  </>;
}

function App() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function open() {
      setError(''); setSession(undefined);
      try {
        const session = await loadSession();
        if (!cancelled) setSession(session);
      } catch (error) { if (!cancelled) setError((error as Error).message); }
    }
    const onHashChange = () => { if (location.hash.includes('session=')) void open(); };
    void open();
    window.addEventListener('hashchange', onHashChange);
    return () => { cancelled = true; window.removeEventListener('hashchange', onHashChange); };
  }, []);
  if (error) return <div className="mx-auto max-w-lg p-8"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>;
  if (!session) return <div className="flex h-svh" aria-label="Loading review"><div className="hidden w-64 space-y-3 border-r p-4 md:block">
    <Skeleton className="h-8 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
    <div className="flex-1 space-y-4 p-5"><Skeleton className="h-7 w-48" /><Skeleton className="h-72 w-full" /></div></div>;
  return <SidebarProvider className="h-svh min-h-0" style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
    <ReviewWorkspace session={session} />
  </SidebarProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
