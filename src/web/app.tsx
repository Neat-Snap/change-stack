import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PatchDiff } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { ChevronLeft, ChevronRight, Files, TriangleAlert } from 'lucide-react';
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
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const { isMobile, setOpenMobile } = useSidebar();
  const layer = analysis.layers.find(layer => layer.id === activeLayer);
  const files = review.files.filter(file => !layer || layer.files.includes(file.path));
  const warnings = [...review.warnings, ...analysis.warnings];
  const [theme, setTheme] = useState<ReviewTheme>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light');
  const dark = theme.endsWith('dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = theme;
  }, [theme, dark]);
  useEffect(() => { document.title = `${review.target.project} #${review.target.number}`; }, [review]);

  function chooseLayer(id: string) {
    setActiveLayer(id);
    requestAnimationFrame(() => summary.current?.scrollIntoView({ block: 'start' }));
    if (isMobile) setOpenMobile(false);
  }
  function chooseFile(path: string) {
    sections.current.get(path)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (isMobile) setOpenMobile(false);
  }

  function setFileCollapsed(path: string, value: boolean) {
    setCollapsed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
  }
  function markReviewed(path: string, value: boolean) {
    setReviewed(previous => { const next = new Set(previous); if (value) next.add(path); else next.delete(path); return next; });
    setFileCollapsed(path, value);
  }

  return <>
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
          <div className="px-3">
            <CollapsibleTrigger className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:text-foreground" aria-label="Layers">
              <ChevronRight className={`size-3 shrink-0 transition-transform ${layersOpen ? 'rotate-90' : ''}`} />Layers
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden" data-testid="layers-panel">
            <ScrollArea className="h-full" data-testid="layers-scroll">
              <SidebarGroup className="px-3 pb-3 pt-0">
                <SidebarGroupContent><SidebarMenu className="gap-1" aria-label="Review layers">
                  {analysis.layers.map((layer, index) => <SidebarMenuItem key={layer.id}>
                    <SidebarMenuButton isActive={activeLayer === layer.id} onClick={() => chooseLayer(layer.id)}
                      className="h-auto min-h-10 items-start gap-3 py-2.5" data-testid="layer-button">
                      <span className="mt-0.5 w-3 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="whitespace-normal! overflow-visible! text-[13px] leading-5">{layer.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>)}
                </SidebarMenu></SidebarGroupContent>
              </SidebarGroup>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible open={treeOpen} onOpenChange={setTreeOpen} className={`flex min-h-0 flex-col ${treeOpen ? 'flex-1' : 'shrink-0'}`}>
          <div className="flex shrink-0 items-center gap-2 px-3 py-1">
            <CollapsibleTrigger className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-muted-foreground hover:text-foreground" aria-label={treeOpen ? 'Collapse file tree' : 'Expand file tree'}>
              <ChevronRight className={`size-3 transition-transform ${treeOpen ? 'rotate-90' : ''}`} /><Files className="size-3.5" />
            </CollapsibleTrigger>
            <Separator className="flex-1" />
          </div>
          <CollapsibleContent className="min-h-0 flex-1 overflow-hidden px-3 pb-3" data-testid="tree-panel">
            <Tree key={activeLayer} files={files} select={chooseFile} />
          </CollapsibleContent>
        </Collapsible>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="h-svh min-w-0 overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-5">
        <SidebarTrigger className="-ml-1 size-7 text-muted-foreground" />
        <Separator orientation="vertical" className="!h-4" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{layer?.title ?? 'All changes'}</span>
        <div className="flex shrink-0 items-center gap-0.5" aria-label="Layer navigation">
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="Previous layer"
            disabled={activeLayerIndex <= 0} onClick={() => chooseLayer(analysis.layers[activeLayerIndex - 1]!.id)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="Next layer"
            disabled={!analysis.layers.length || activeLayerIndex >= analysis.layers.length - 1}
            onClick={() => chooseLayer(analysis.layers[activeLayerIndex + 1]!.id)}><ChevronRight className="size-3.5" /></Button>
        </div>
        <Select value={theme} onValueChange={value => setTheme(value as ReviewTheme)}>
          <SelectTrigger aria-label="Theme" className="h-7! w-auto border-0 bg-transparent! px-2 text-xs shadow-none"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(themes).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Tabs value={layout} onValueChange={value => setLayout(value as 'split' | 'unified')}>
          <TabsList className="h-7 rounded-md"><TabsTrigger value="split" className="px-3 text-xs">Split</TabsTrigger>
            <TabsTrigger value="unified" className="px-3 text-xs">Unified</TabsTrigger></TabsList>
        </Tabs>
      </header>
      <ScrollArea className="min-h-0 flex-1" data-testid="diff-scroll">
        <div className="space-y-4 p-3 sm:space-y-5 sm:p-5">
          <div ref={summary} className="scroll-mt-5 rounded-lg border bg-sidebar/40 p-4 sm:p-5" data-testid={layer ? 'layer-summary' : 'pr-summary'}>
            <Summary text={layer?.summary ?? analysis.summary} />
          </div>
          {warnings.map((warning, index) => <Alert key={index} className="text-muted-foreground"><TriangleAlert className="size-4" />
            <AlertDescription>{warning}</AlertDescription></Alert>)}
          {files.map(file => <section ref={element => { if (element) sections.current.set(file.path, element); else sections.current.delete(file.path); }} key={file.path} aria-label={file.path} className="diff-container scroll-mt-5 overflow-hidden rounded-lg border bg-background" data-testid="file-diff">
            <Collapsible open={!collapsed.has(file.path)} onOpenChange={open => setFileCollapsed(file.path, !open)}>
              <div className="flex min-h-11 items-center gap-3 bg-sidebar/60 px-3">
                <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left text-xs" aria-label={`${collapsed.has(file.path) ? 'Expand' : 'Collapse'} ${file.path}`}>
                  <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed.has(file.path) ? '' : 'rotate-90'}`} />
                  <span className="truncate font-mono">{file.path}</span>
                </CollapsibleTrigger>
                <span className="hidden shrink-0 font-mono text-[11px] tabular-nums sm:inline"><span className="text-green-600 dark:text-green-400">+{file.additions}</span> <span className="text-red-600 dark:text-red-400">−{file.deletions}</span></span>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={reviewed.has(file.path)} onCheckedChange={checked => markReviewed(file.path, checked === true)} aria-label={`Mark ${file.path} as reviewed`} />
                  <span className="hidden sm:inline">Reviewed</span>
                </label>
              </div>
              <CollapsibleContent className="border-t" data-testid="file-diff-content">
            {file.incomplete && <div className="border-b px-4 py-3 text-xs text-muted-foreground">{file.path}: this patch is incomplete.</div>}
            {file.patch ? <DiffBoundary key={file.path} patch={file.patch}>
              <PatchDiff patch={file.patch} options={{ theme,
                themeType: dark ? 'dark' : 'light', diffStyle: layout, preferredHighlighter: 'shiki-js',
                enableLineSelection: true, disableFileHeader: true }} />
            </DiffBoundary> : <div className="p-4 text-sm text-muted-foreground">{file.path} · No text patch available.</div>}
              </CollapsibleContent>
            </Collapsible>
          </section>)}
          {!files.length && <p className="p-5 text-sm text-muted-foreground">No changes to display.</p>}
        </div>
      </ScrollArea>
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
