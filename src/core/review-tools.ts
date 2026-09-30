import { repositoryReader } from './repository';
import type { HostConfig, Review } from './types';
import type { SourcePair } from './changes';

export interface SymbolMatch { path: string; line: number; startLine: number; snippet: string; kind: 'definition' | 'reference' }
export interface SymbolResult { symbol: string; matches: SymbolMatch[]; scanned: number; unavailable: number; limited: boolean }
export interface ReviewTools { context(path: string): Promise<SourcePair>; lookup(symbol: string, path: string): Promise<SymbolResult> }

export function reviewTools(review: Review, host: HostConfig): ReviewTools {
  const head = repositoryReader(review, host, { maxChars: 250_000 });
  const base = review.baseSha ? repositoryReader(review, host, { ref: review.baseSha, repository: review.baseRepository ?? review.target.project, maxChars: 250_000 }) : undefined;
  // In-memory only, bounded cache shared by context and symbol requests.
  const cache = new Map<string, Promise<string>>();
  const read = (path: string, side: 'old' | 'current') => {
    const key = `${side}:${path}`;
    const found = cache.get(key); if (found) return found;
    if (cache.size >= 24) cache.delete(cache.keys().next().value!);
    const reader = side === 'old' ? base : head;
    const value = (async () => {
      if (!reader) throw new Error('Base commit unavailable.');
      const result = await reader({ tool: 'read_file', path }) as { content: string; truncated: boolean };
      if (result.truncated) throw new Error('File exceeds the context budget.');
      return result.content;
    })();
    cache.set(key, value); value.catch(() => cache.delete(key)); return value;
  };
  return {
    async context(path) {
      const file = review.files.find(f => f.path === path); if (!file) throw new Error('Unknown changed file.');
      const [old, current] = await Promise.all([file.status === 'added' ? '' : read(file.oldPath, 'old'), file.status === 'deleted' ? '' : read(file.path, 'current')]);
      return { old, current };
    },
    async lookup(symbol, path) {
      if (!/^[A-Za-z_$][\w$]{1,79}$/.test(symbol) || !review.files.some(f => f.path === path)) throw new Error('Invalid symbol lookup.');
      const candidates = new Set([path, ...review.files.filter(f => f.status !== 'deleted').map(f => f.path)]);
      const directories = [...new Set([path.split('/').slice(0, -1).join('/'), '', ...review.files.map(f => f.path.split('/').slice(0, -1).join('/'))])].slice(0, 4);
      let unavailable = 0;
      for (const directory of directories) {
        try {
          const listing = await head({ tool: 'list_files', path: directory }) as { entries: { path: string; type: string }[] };
          for (const entry of listing.entries) if (entry.type === 'blob' || entry.type === 'file') candidates.add(entry.path);
        } catch { unavailable++; }
      }
      const paths = [...candidates].filter(p => !/\.(png|jpe?g|gif|webp|svg|lock|pdf|zip|woff2?)$/i.test(p)).slice(0, 24);
      const matches: SymbolMatch[] = []; let scanned = 0;
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const word = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`);
      const definition = new RegExp(`(?:function|class|interface|type|enum|const|let|var|def|struct|fn)\\s+${escaped}(?![\\w$])`);
      for (const candidate of paths) {
        try {
          const content = await read(candidate, 'current'); scanned++;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && matches.length < 100; i++) if (word.test(lines[i])) {
            const start = Math.max(0, i - 3);
            matches.push({ path: candidate, line: i + 1, startLine: start + 1, snippet: lines.slice(start, i + 4).join('\n').slice(0, 3000), kind: definition.test(lines[i]) ? 'definition' : 'reference' });
          }
        } catch { unavailable++; }
      }
      matches.sort((a, b) => Number(b.kind === 'definition') - Number(a.kind === 'definition'));
      return { symbol, matches, scanned, unavailable, limited: candidates.size > paths.length || matches.length >= 100 };
    },
  };
}
