import { serviceFetch } from './network';
import { gitApiBase } from './target';
import type { HostConfig, Review } from './types';

export class RepositoryReadError extends Error {}

export interface RepositoryRequest { tool: 'list_files' | 'read_file'; path: string; page?: number }
export type RepositoryReader = (request: RepositoryRequest) => Promise<unknown>;

// One tool call makes at most one read-only HTTP request, at the review's head SHA or an explicitly pinned base SHA.
export function repositoryReader(review: Review, host: HostConfig, options: { ref?: string; repository?: string; maxChars?: number; raw?: boolean; maxBytes?: number } = {}): RepositoryReader {
  if (host.provider !== review.target.provider || new URL(host.baseUrl).origin !== review.target.origin) throw new Error('Repository host mismatch.');
  const api = gitApiBase(host);
  const prefix = new URL(host.baseUrl).pathname.replace(/^\/|\/$/g, '');
  const project = options.repository ?? review.repository ?? (prefix && review.target.project.startsWith(`${prefix}/`)
    ? review.target.project.slice(prefix.length + 1) : review.target.project);
  const projectPath = host.provider === 'gitlab' ? `/projects/${encodeURIComponent(project)}/repository`
    : `/repos/${project.split('/').map(encodeURIComponent).join('/')}/contents`;
  return async request => {
    if (!['list_files', 'read_file'].includes(request.tool) || typeof request.path !== 'string'
      || request.path.length > 1_000 || request.path.startsWith('/') || request.path.includes('\\')
      || request.path.split('/').some(part => part === '.' || part === '..') || /[\x00-\x1f]/.test(request.path)
      || (request.tool === 'read_file' && !request.path)) throw new Error('Invalid repository request.');
    const page = request.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid repository page.');
    const ref = encodeURIComponent(options.ref ?? review.headSha);
    const path = encodeURIComponent(request.path);
    const raw = options.raw && request.tool === 'read_file';
    const suffix = host.provider === 'gitlab'
      ? request.tool === 'list_files' ? `/tree?ref=${ref}&path=${path}&per_page=100&page=${page}` : `/files/${path}${raw ? "/raw" : ""}?ref=${ref}`
      : `${request.path ? `/${request.path.split('/').map(encodeURIComponent).join('/')}` : ''}?ref=${ref}`;
    const response = await serviceFetch(`${api}${projectPath}${suffix}`, new URL(api).origin, { headers: host.provider === 'gitlab'
      ? { 'PRIVATE-TOKEN': host.token } : { Authorization: `Bearer ${host.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' } });
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > (options.maxBytes ?? 512_000)) throw new RepositoryReadError(raw ? 'This file is too large to load surrounding code. Its diff is still available.' : 'Repository response exceeded the read budget.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      if (text.includes('\0')) throw new RepositoryReadError('Surrounding code is unavailable for binary files.');
      return { path: request.path, content: text, truncated: false };
    }
    const value = JSON.parse(text);
    if (request.tool === 'list_files') {
      if (!Array.isArray(value)) throw new Error('Expected a repository directory.');
      return { entries: value.slice(0, 100).map(entry => ({ path: entry.path, type: entry.type })),
        truncated: value.length > 100, nextPage: host.provider === 'gitlab' && value.length === 100 ? page + 1 : undefined };
    }
    if (Array.isArray(value) || value.encoding !== 'base64' || typeof value.content !== 'string') throw new Error('Text file content is unavailable.');
    const content = Buffer.from(value.content, 'base64').toString('utf8');
    if (content.includes('\0')) throw new Error('Binary files cannot be read.');
    return { path: request.path, content: content.slice(0, options.maxChars ?? 24_000), truncated: content.length > (options.maxChars ?? 24_000) };
  };
}
