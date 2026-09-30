import { serviceUrl } from './target';

// Every outbound request is scoped to a configured origin. Never forward tokens through redirects.
export async function serviceFetch(url: string, allowedOrigin: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  const target = new URL(url);
  if (target.origin !== serviceUrl(allowedOrigin).origin || target.username || target.password) {
    throw new Error('Blocked request outside the configured service origin.');
  }
  const response = await fetch(target, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    // Response bodies can contain code, credentials, or reverse-proxy details. Do not log them.
    throw new Error(`Service returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check your token and access permissions.' : 'Check the service URL and retry.'}`);
  }
  return response;
}

export async function serviceJson<T>(url: string, allowedOrigin: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return (await serviceFetch(url, allowedOrigin, init, timeoutMs)).json() as Promise<T>;
}
