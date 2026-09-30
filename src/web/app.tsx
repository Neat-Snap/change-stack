import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Virtualizer } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { Check, ChevronLeft, ChevronRight, Columns2, Rows2, Sun, Moon, Files, TriangleAlert, Search, Keyboard, ExternalLink, GitBranch, MessageSquareText, X } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ReviewSearch, type SearchResult } from './review-search';
import { ReviewPatch, readApi, patchLineOffset, type LineTarget } from './review-patch';
import { FileSection, Counts } from './file-section';
import { ReviewIntro, NextLayer, reviewRef, type LayerStat } from './review-intro';
import { CodePeek, type PeekState } from './code-peek';
import type { SymbolResult } from '../core/review-tools';
import { layerFile, partAnchors } from '../core/changes';
import { CategoryPill, LayerMap } from './layer-map';
import { Shortcuts } from './shortcuts';
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

function ReviewWorkspace({ session }: { session: Session }) {
  const { review } = session;
  // Groups are only meaningful when they partition the layers exactly.
  const analysis = useMemo(() => {
    const ids = new Set(session.analysis.layers.map(l => l.id)), grouped = session.analysis.groups?.flatMap(g => g.layers);
    return grouped && grouped.length === ids.size && new Set(grouped).size === ids.size && grouped.every(id => ids.has(id))
      ? session.analysis : { ...session.analysis, groups: undefined };
  }, [session]);
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
  const [panel, setPanel] = useState<string>();
  const [mapOpen, setMapOpen] = useState(false);
  const [notesVisible, setNotesVisible] = useState(true);
  const pendingJump = useRef<{ path: string; line?: number; side?: 'old' | 'current' } | undefined>(undefined);
  const layer = analysis.layers.find(layer => layer.id === activeLayer);
  const files = useMemo(() => review.files.filter(file => !layer || layer.files.includes(file.path)).map(file => layer?.ranges && file.patch ? layerFile(file, layer.ranges) : file), [review.files, layer]);
  const shownFiles = useRef(files); shownFiles.current = files;
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
      pendingJump.current = undefined;
      const pane = section.closest('.diff-viewport') as HTMLElement;
      const file = shownFiles.current.find(f => f.path === jump.path);
      const margin = 36 + 64;
      const row = () => {
        const root = section.querySelector('diffs-container')?.shadowRoot;
        return root?.querySelector(`[data-code-column="${jump.side === 'old' ? 'deletions' : 'additions'}"] [data-line="${jump.line}"]`) ?? root?.querySelector(`[data-line="${jump.line}"]`);
      };
      // Re-evaluated every frame: rows render only near the viewport, so the exact line
      // position becomes known during the animation and the scroll ends precisely on it.
      const target = () => {
        const paneTop = pane.getBoundingClientRect().top, sectionTop = pane.scrollTop + section.getBoundingClientRect().top - paneTop;
        if (!jump.line) return sectionTop;
        const rendered = row();
        return rendered ? pane.scrollTop + rendered.getBoundingClientRect().top - paneTop - margin
          : sectionTop + 36 + (file ? patchLineOffset(file.patch, jump.line, jump.side ?? 'current', layout) : 0) - margin;
      };
      smoothScroll(pane, target);
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
  function jumpToPart(index: number) {
    const part = layer?.parts?.[index]; if (!part) return;
    for (const file of files) {
      const anchor = partAnchors(review.files.find(f => f.path === file.path)!, [part])[0];
      if (!anchor) continue;
      setFileCollapsed(file.path, false);
      pendingJump.current = { path: file.path, line: anchor.lineNumber, side: anchor.side === 'deletions' ? 'old' : 'current' };
      performJump();
      return;
    }
  }
  function toggleMap() { setMapOpen(value => !value); }
  function openOrigin() { window.open(review.target.url, '_blank', 'noopener,noreferrer'); }
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
      else if (event.key === 'g' && analysis.layers.length > 1) { event.preventDefault(); toggleMap(); }
      else if (event.key === 'n') { event.preventDefault(); setNotesVisible(value => !value); }
      else if (event.key === 'o') { event.preventDefault(); openOrigin(); }
      else if (event.key === 'Escape' && (mapOpen || panel)) { event.preventDefault(); if (mapOpen) setMapOpen(false); else setPanel(undefined); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [files, activeLayerIndex, searchOpen, peek, shortcutsOpen, isMobile, open, openMobile, panel, mapOpen]);

  function setFileCollapsed(path: string, value: boolean) {
    setCollapsed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
  }
  function markReviewed(path: string, value: boolean) {
    setReviewed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
    setFileCollapsed(path, value);
  }

  const layerStats = useMemo<LayerStat[]>(() => analysis.layers.map(l => {
    const shown = review.files.filter(f => l.files.includes(f.path)).map(f => l.ranges && f.patch ? layerFile(f, l.ranges) : f);
    return { paths: shown.map(f => f.path), additions: shown.reduce((n, f) => n + f.additions, 0), deletions: shown.reduce((n, f) => n + f.deletions, 0) };
  }), [analysis.layers, review.files]);
  const reviewedCount = review.files.filter(f => reviewed.has(f.path)).length;

  return <>
    <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <ReviewSearch session={session} open={searchOpen} setOpen={setSearchOpen} choose={chooseResult} />
    <CodePeek state={peek} close={closePeek} lookup={symbol => void lookupSymbol(symbol, lookupPath.current)} canJump={path => review.files.some(f => f.path === path)} jump={(path, line) => { closePeek(); jumpAnywhere(path, line); }} />
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader className="gap-0 p-0">
        <div className="min-w-0 px-4 pb-3 pt-3" data-testid="pr-identity">
          <a href={review.target.url} target="_blank" rel="noopener noreferrer" className="group flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            title={`Open in ${review.target.provider === 'gitlab' ? 'GitLab' : 'GitHub'} (O)`}>
            <span className="truncate">{review.target.project}</span><span className="shrink-0 tabular-nums">{reviewRef(review)}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
          <p className="mt-1 line-clamp-3 text-[13px] font-medium leading-5" title={review.title}>{review.title}</p>
          <p className="mt-1.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground" title={`${review.sourceBranch} → ${review.targetBranch}${review.author ? ` · ${review.author}` : ''}`}>
            <GitBranch className="size-3 shrink-0" aria-hidden /><span className="truncate">{review.sourceBranch}</span><span className="shrink-0">→ {review.targetBranch}</span>
          </p>
        </div>
        <button onClick={() => chooseLayer('all')} data-active={activeLayer === 'all'}
          className="flex h-8 w-full items-center gap-2 border-t px-4 text-left text-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent">
          <Files className="size-3.5 text-muted-foreground" /><span className="text-[13px] font-medium">All changes</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{review.files.length}</span>
        </button>
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden!">
        <Collapsible open={layersOpen} onOpenChange={setLayersOpen}
          className={`flex min-h-0 flex-col ${layersOpen ? treeOpen ? 'max-h-[50%] flex-[0_1_50%]' : 'flex-1' : 'shrink-0'}`}>
          <div className="relative z-10 shrink-0 border-y bg-sidebar">
            <CollapsibleTrigger className="flex h-8 w-full items-center gap-2 px-4 text-left text-foreground hover:bg-sidebar-accent" aria-label="Layers">
              <span className="font-sans text-[13px] font-medium">Layers</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{analysis.layers.length}</span>
              <ChevronRight className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${layersOpen ? 'rotate-90' : ''}`} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden" data-testid="layers-panel">
            <ScrollArea className="h-full rounded-none" data-testid="layers-scroll">
              <SidebarGroup className="px-2 pb-2 pt-2">
                <SidebarGroupContent><SidebarMenu className="gap-px" aria-label="Review layers">
                  {analysis.layers.map((layer, index) => {
                    const stat = layerStats[index]!, done = stat.paths.length > 0 && stat.paths.every(path => reviewed.has(path));
                    const group = analysis.groups?.find(g => g.layers[0] === layer.id);
                    return <React.Fragment key={layer.id}>
                      {group && <li className={`px-2 pb-1 text-[11px] text-muted-foreground ${index ? 'pt-3' : 'pt-0.5'}`} data-testid="layer-group">{group.title}</li>}
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive={activeLayer === layer.id} onClick={() => chooseLayer(layer.id)}
                          className="h-auto items-start gap-2.5 py-1.5" data-testid="layer-button">
                          <span className="mt-0.5 flex w-4 shrink-0 justify-center text-[11px] tabular-nums text-muted-foreground">
                            {done ? <Check className="size-3.5 text-green-600 dark:text-green-400" aria-label="Reviewed" /> : index + 1}</span>
                          <span className="min-w-0 flex-1 overflow-visible! whitespace-normal!">
                            <span className={`line-clamp-2 text-[13px] leading-5 ${done ? 'text-muted-foreground' : ''}`}>{layer.title}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                              <CategoryPill category={layer.category} className="min-w-0" />
                              <span className="shrink-0">{stat.paths.length} {stat.paths.length === 1 ? 'file' : 'files'}</span>
                              <Counts additions={stat.additions} deletions={stat.deletions} className="shrink-0 opacity-80" />
                            </span>
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </React.Fragment>;
                  })}
                </SidebarMenu></SidebarGroupContent>
              </SidebarGroup>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible open={treeOpen} onOpenChange={setTreeOpen} className={`flex min-h-0 flex-col ${treeOpen ? 'flex-1' : 'shrink-0'}`}>
          <div className={`relative z-10 shrink-0 bg-sidebar ${layersOpen ? "border-y" : "border-b"}`}>
            <CollapsibleTrigger className="flex h-8 w-full items-center gap-2 px-4 text-left text-foreground hover:bg-sidebar-accent" aria-label={treeOpen ? 'Collapse file tree' : 'Expand file tree'}>
              <span className="font-sans text-[13px] font-medium">Files</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{files.length}</span>
              <ChevronRight className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${treeOpen ? 'rotate-90' : ''}`} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-1" data-testid="tree-panel">
            <Tree key={activeLayer} files={files} select={chooseFile} />
          </CollapsibleContent>
        </Collapsible>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="relative h-svh min-w-0 overflow-hidden">
      <header data-review-toolbar className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="size-7 text-muted-foreground" />
        <Separator orientation="vertical" className="!h-4" />
        <span className="min-w-0 flex-1 truncate pl-1 text-[13px]">
          {layer ? <><span className="mr-2 tabular-nums text-muted-foreground">{activeLayerIndex + 1}/{analysis.layers.length}</span><span className="font-medium">{layer.title}</span></> : <span className="font-medium">All changes</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-2 pr-2 text-[11px] tabular-nums text-muted-foreground md:flex" data-testid="review-progress" title="Files marked as reviewed">
          <span className="h-1 w-16 overflow-hidden rounded-full bg-accent"><span className="block h-full rounded-full bg-green-600 transition-[width] dark:bg-green-400" style={{ width: `${review.files.length ? 100 * reviewedCount / review.files.length : 0}%` }} /></span>
          {reviewedCount}/{review.files.length} reviewed
        </span>
        <div className="flex shrink-0 items-center" aria-label="Layer navigation">
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Previous layer" title="Previous layer (K)"
            disabled={activeLayerIndex <= 0} onClick={() => chooseLayer(analysis.layers[activeLayerIndex - 1]!.id)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Next layer" title="Next layer (J)"
            disabled={!analysis.layers.length || activeLayerIndex >= analysis.layers.length - 1}
            onClick={() => chooseLayer(analysis.layers[activeLayerIndex + 1]!.id)}><ChevronRight className="size-3.5" /></Button>
        </div>
        <Separator orientation="vertical" className="!h-4" />
        {!!layer?.parts?.length && <Button variant="ghost" size="icon" className={`size-7 ${notesVisible ? 'bg-accent text-foreground' : 'text-muted-foreground'}`} aria-pressed={notesVisible}
          aria-label="Part notes" title="Show part notes in the code (N)" onClick={() => setNotesVisible(value => !value)}><MessageSquareText className="size-4" /></Button>}
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Search changes" title="Search (⌘/Ctrl K)" onClick={() => setSearchOpen(true)}><Search className="size-4" /></Button>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard className="size-4" /></Button>
        <Select value={theme} onValueChange={value => setTheme(value as ReviewTheme)}>
          <SelectTrigger aria-label="Theme" title="Theme" className="h-7! w-7! justify-center border-0 bg-transparent! p-0 text-muted-foreground shadow-none [&>svg:last-child]:hidden">{dark ? <Moon className="size-4" /> : <Sun className="size-4" />}<span className="sr-only"><SelectValue /></span></SelectTrigger>
          <SelectContent>{Object.entries(themes).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Tabs value={layout} onValueChange={value => setLayout(value as 'split' | 'unified')}>
          <TabsList className="h-7 gap-0.5 bg-transparent p-0"><TabsTrigger value="split" aria-label="Split" title="Split diff (U)" className="h-7! w-7! flex-none rounded-sm p-0 text-muted-foreground shadow-none! data-[state=active]:bg-accent data-[state=active]:text-foreground"><Columns2 className="size-3.5" /></TabsTrigger>
            <TabsTrigger value="unified" aria-label="Unified" title="Unified diff (U)" className="h-7! w-7! flex-none rounded-sm p-0 text-muted-foreground shadow-none! data-[state=active]:bg-accent data-[state=active]:text-foreground"><Rows2 className="size-3.5" /></TabsTrigger></TabsList>
        </Tabs>
      </header>
      <div className="relative flex min-h-0 flex-1">
      <div className="min-w-0 flex-1" data-testid="diff-scroll" style={{ '--change-stack-split-left': `${splitRatio}%` } as React.CSSProperties}>
        <Virtualizer className="diff-viewport h-full overflow-auto" config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}>
          <ReviewIntro ref={summary} review={review} analysis={analysis} layer={layer} stats={layerStats} reviewed={reviewed} choose={chooseLayer}
            jumpToPart={jumpToPart} openMap={toggleMap} />
          {warnings.map((warning, index) => <p key={index} role="note" className="flex items-start gap-2 border-b px-5 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />{warning}</p>)}
          {files.map(file => <FileSection key={`${activeLayer}:${file.path}`} file={file} original={review.files.find(f => f.path === file.path)!} ranges={layer?.ranges} parts={notesVisible ? layer?.parts : undefined}
            otherLayers={analysis.layers.filter(l => l.id !== layer?.id && l.files.includes(file.path)).length}
            reviewed={reviewed.has(file.path)} collapsed={collapsed.has(file.path)} onCollapsedChange={value => setFileCollapsed(file.path, value)}
            onReviewedChange={value => markReviewed(file.path, value)} onWholeFile={() => setPanel(file.path)}
            onPeek={() => { lookupPath.current = file.path; setPeek({ symbol: '' }); }}
            sectionRef={element => { if (element) sections.current.set(file.path, element); else sections.current.delete(file.path); }}
            theme={theme} layout={layout} splitRatio={splitRatio} onSplitRatioChange={setSplitRatio} contextAvailable={!!review.baseSha}
            lookup={(symbol, path) => void lookupSymbol(symbol, path)} target={target} />)}
          {!files.length && <p className="p-5 text-sm text-muted-foreground">No changes to display.</p>}
          {layer && files.length > 0 && <NextLayer next={analysis.layers[activeLayerIndex + 1]} index={activeLayerIndex} choose={chooseLayer} overview={() => chooseLayer('all')} />}
        </Virtualizer>
      </div>
      {panel && <SidePanel title={panel} subtitle="Whole file · every change in this pull request" close={() => setPanel(undefined)}>
        <Virtualizer className="diff-container h-full overflow-auto" data-testid="whole-file">
          <ReviewPatch patch={review.files.find(f => f.path === panel)!.patch} path={panel} theme={theme} layout="unified" lookup={(symbol, path) => void lookupSymbol(symbol, path)} />
        </Virtualizer>
      </SidePanel>}
      </div>
      {mapOpen && <section className="absolute inset-0 z-40 flex flex-col bg-background" aria-label="Layer map" data-testid="map-overlay">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="min-w-0 flex-1 truncate pl-1 text-[13px] font-medium">Layer map</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">{analysis.layers.length} layers{analysis.groups?.length ? ` · ${analysis.groups.length} groups` : ''}</span>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Close layer map" title="Close (Esc)" onClick={() => setMapOpen(false)}><X className="size-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto"><LayerMap analysis={analysis} stats={layerStats} reviewed={reviewed} active={activeLayer} choose={id => { setMapOpen(false); chooseLayer(id); }} /></div>
      </section>}
    </SidebarInset>
  </>;
}

const scrolls = new WeakMap<HTMLElement, number>();
// A short eased scroll. Long distances first skip to about one screen from the target,
// so the animation stays quick and does not render every row in between.
function smoothScroll(pane: HTMLElement, target: () => number, duration = 260) {
  cancelAnimationFrame(scrolls.get(pane) ?? 0);
  const clamp = (value: number) => Math.max(0, Math.min(value, pane.scrollHeight - pane.clientHeight));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { pane.scrollTop = clamp(target()); return; }
  const initial = target(), limit = pane.clientHeight;
  if (Math.abs(initial - pane.scrollTop) > limit * 2) pane.scrollTop = initial - Math.sign(initial - pane.scrollTop) * limit;
  const from = pane.scrollTop, started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / duration), eased = 1 - (1 - t) ** 3;
    pane.scrollTop = clamp(from + (target() - from) * eased);
    if (t < 1) scrolls.set(pane, requestAnimationFrame(step)); else scrolls.delete(pane);
  };
  scrolls.set(pane, requestAnimationFrame(step));
}

function SidePanel({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: React.ReactNode }) {
  const [width, setWidth] = useState(() => Math.round(Math.min(720, window.innerWidth * 0.46)));
  const clamp = (value: number) => Math.round(Math.max(320, Math.min(value, window.innerWidth - 160)));
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    const right = event.currentTarget.parentElement!.getBoundingClientRect().right;
    setWidth(clamp(right - event.clientX));
  };
  // The panel floats over the diff so opening it never reflows the code being read.
  return <aside style={{ width }} className="absolute inset-y-0 right-0 z-30 flex max-w-full flex-col border-l bg-background shadow-2xl shadow-black/30 max-md:w-full!" aria-label={title} data-testid="side-panel">
    <div role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0} aria-valuenow={width} aria-valuemin={320}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:w-0.5 hover:after:bg-ring focus-visible:outline-none focus-visible:after:w-0.5 focus-visible:after:bg-ring max-md:hidden"
      title="Drag to resize · double-click to reset"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event); }}
      onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
      onDoubleClick={() => setWidth(clamp(window.innerWidth * 0.46))}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        setWidth(value => clamp(value + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 80 : 20)));
      }} />
    <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-sidebar pl-3 pr-1.5">
      <p className="min-w-0 flex-1 truncate text-xs"><span className={`font-medium ${subtitle ? 'font-mono' : ''}`}>{title}</span>{subtitle && <span className="ml-2 font-sans text-muted-foreground">{subtitle}</span>}</p>
      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Close panel" title="Close (Esc)" onClick={close}><X className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1">{children}</div>
  </aside>;
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
