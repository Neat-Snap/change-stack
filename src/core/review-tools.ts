import { RepositoryReadError, repositoryReader } from './repository';
import type { HostConfig, Review } from './types';
import type { SourcePair } from './changes';

export interface SymbolMatch { path: string; line: number; startLine: number; snippet: string; kind: 'definition' | 'reference' }
export interface SymbolResult { symbol: string; matches: SymbolMatch[]; scanned: number; unavailable: number; limited: boolean }
export interface ReviewTools { context(path: string): Promise<SourcePair>; lookup(symbol: string, path: string): Promise<SymbolResult> }

export function reviewTools(review: Review, host: HostConfig): ReviewTools {
  const head = repositoryReader(review, host, { maxChars: 250_000 });
  const base = review.baseSha ? repositoryReader(review, host, { ref: review.baseSha, repository: review.baseRepository ?? review.target.project, raw: true, maxBytes: 2_000_000 }) : undefined;
  const contextHead = repositoryReader(review, host, { raw: true, maxBytes: 2_000_000 });
  // In-memory only: at most 24 entries and 8 million cached text characters.
  const cache = new Map<string, Promise<string>>();
  const sizes = new Map<string, number>();
  const evict = (key: string) => { cache.delete(key); sizes.delete(key); };
  const read = (path: string, side: 'old' | 'current', context = false) => {
    const key = `${context ? 'context' : 'symbol'}:${side}:${path}`;
    const found = cache.get(key); if (found) return found;
    if (cache.size >= 24) evict(cache.keys().next().value!);
    const reader = side === 'old' ? base : context ? contextHead : head;
    let value!: Promise<string>;
    value = (async () => {
      if (!reader) throw new RepositoryReadError('The original commit is unavailable, so surrounding code cannot be loaded.');
      const result = await reader({ tool: 'read_file', path }) as { content: string; truncated: boolean };
      if (result.truncated) throw new RepositoryReadError('This file is too large for symbol search.');
      if (cache.get(key) === value) {
        sizes.set(key, result.content.length);
        while ([...sizes.values()].reduce((sum, size) => sum + size, 0) > 8_000_000) evict(cache.keys().next().value!);
      }
      return result.content;
    })();
    cache.set(key, value); value.catch(() => { if (cache.get(key) === value) evict(key); }); return value;
  };
  return {
    async context(path) {
      const file = review.files.find(f => f.path === path); if (!file) throw new Error('Unknown changed file.');
      const [old, current] = await Promise.all([file.status === 'added' ? '' : read(file.oldPath, 'old', true), file.status === 'deleted' ? '' : read(file.path, 'current', true)]);
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
