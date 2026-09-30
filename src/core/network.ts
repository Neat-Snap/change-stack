import { rootCertificates } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { serviceUrl } from './target';

let extraCA: { path: string; certificates: Promise<string[]> } | undefined;
async function trustedCertificates(): Promise<string[] | undefined> {
  const path = process.env.CHANGE_STACK_CA_FILE;
  if (!path) return undefined;
  if (extraCA?.path !== path) extraCA = { path, certificates: (async () => {
    const pem = await readFile(path, 'utf8');
    if (!pem.includes('-----BEGIN CERTIFICATE-----') || pem.length > 2_000_000) throw new Error('Invalid corporate CA certificate file.');
    return [...rootCertificates, pem];
  })() };
  return extraCA.certificates;
}

// Every outbound request is scoped to a configured origin. Never forward tokens through redirects.
export async function serviceFetch(url: string, allowedOrigin: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  const target = new URL(url);
  if (target.origin !== serviceUrl(allowedOrigin).origin || target.username || target.password) {
    throw new Error('Blocked request outside the configured service origin.');
  }
  const response = await fetch(target, { ...init, tls: { rejectUnauthorized: true, ca: await trustedCertificates() }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    // Response bodies can contain code, credentials, or reverse-proxy details. Do not log them.
    throw new Error(`Service returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check your token and access permissions.' : 'Check the service URL and retry.'}`);
  }
  return response;
}

export async function serviceJson<T>(url: string, allowedOrigin: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return (await serviceFetch(url, allowedOrigin, init, timeoutMs)).json() as Promise<T>;
}
