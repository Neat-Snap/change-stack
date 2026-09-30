import { RepositoryReadError } from './core/repository';
import type { ReviewTools } from './core/review-tools';
import page from './web/index.html';
import { ask } from './core/analysis';
import type { AIConfig, Session } from './core/types';
import { serviceUrl } from './core/target';

export function startServer(session: Session, ai?: AIConfig, port = 0, publicOrigin?: string, hostname = '127.0.0.1', tools?: ReviewTools) {
  const publicUrl = publicOrigin ? serviceUrl(publicOrigin) : undefined;
  if (publicUrl && publicUrl.pathname !== '/') throw new Error('The public URL must be an origin without a path.');
  const secret = crypto.randomUUID() + crypto.randomUUID();
  let chatBusy = false;
  let reads = 0;
  const server = Bun.serve({
    hostname, port, development: false, maxRequestBodySize: 32_768,
    routes: { '/': page },
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const origin = server.url.origin;
      const cookieName = `change_stack_session_${server.port}`;
      const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
      const allowedHosts = [server.url.host, ...(publicUrl ? [publicUrl.host] : [])];
      const allowedOrigins = [origin, ...(publicUrl ? [publicUrl.origin] : [])];
      if (!allowedHosts.includes(url.host) || !allowedHosts.includes(request.headers.get('host') ?? '')) return json({ error: 'Invalid host.' }, 403);
      if (request.method !== 'GET' && !allowedOrigins.includes(request.headers.get('origin') ?? '')) return json({ error: 'Invalid origin.' }, 403);
      if (url.pathname === '/api/session' && request.method === 'POST') {
        if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Invalid session.' }, 401);
        const secure = request.headers.get('origin')?.startsWith('https:') ? '; Secure' : '';
        return json({ ok: true }, 200, { 'Set-Cookie': `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/${secure}` });
      }
      const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (cookie !== secret) return json({ error: 'Open the URL printed by your CLI to access this session.' }, 401);
      if (url.pathname === '/api/review' && request.method === 'GET') return json(session);
      if (url.pathname === '/api/context' || url.pathname === '/api/symbol') {
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
        if (!tools) return json({ error: 'Repository lookup is unavailable for this review.' }, 400);
        if (reads >= 2) return json({ error: 'A repository lookup is already running. Try again shortly.' }, 429);
        reads++;
        try {
          const body = await request.json() as any;
          if (typeof body.path !== 'string' || !session.review.files.some(f => f.path === body.path)) return json({ error: 'Unknown changed file.' }, 400);
          if (url.pathname === '/api/context') return json(await tools.context(body.path));
          if (typeof body.symbol !== 'string' || !/^[A-Za-z_$][\w$]{1,79}$/.test(body.symbol)) return json({ error: 'Choose a symbol name.' }, 400);
          return json(await tools.lookup(body.symbol, body.path));
        } catch (error) { return json({ error: error instanceof RepositoryReadError ? error.message : 'Could not load code at the reviewed commit. Check your repository access and try again.' }, 422); }
        finally { reads--; }
      }
      if (url.pathname === '/api/ask' && request.method === 'POST') {
        if (!ai) return json({ error: 'AI is not configured for this session.' }, 400);
        if (chatBusy) return json({ error: 'A question is already being processed.' }, 429);
        try {
          const body = await request.json() as any;
          if (typeof body.question !== 'string' || !Array.isArray(body.paths) || body.paths.length > 100 || body.paths.some((p: unknown) => typeof p !== 'string')) return json({ error: 'Invalid question.' }, 400);
          chatBusy = true;
          const answer = await ask(session.review, ai, body.question, body.paths);
          return json({ answer });
        } catch {
          return json({ error: 'Could not answer this question. Check the selected context and your model endpoint.' }, 502);
        } finally { chatBusy = false; }
      }
      return json({ error: 'Not found.' }, 404);
    },
  });
  return { server, url: `${publicUrl ? publicUrl.origin + '/' : server.url}#session=${secret}` };
}
