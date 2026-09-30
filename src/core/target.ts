import type { Provider, ReviewTarget } from './types';

export function serviceUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) service URL without credentials, query parameters, or fragments.');
  }
  return url;
}

export function parseTarget(value: string, provider?: Provider): ReviewTarget {
  const url = new URL(value);
  serviceUrl(url.origin);
  if (url.username || url.password) throw new Error('Review URLs must not contain credentials.');
  const gitlab = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)\/?(?:.*)?$/);
  const github = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?(?:.*)?$/);
  const detected = gitlab ? 'gitlab' : github ? 'github' : undefined;
  if (!detected || (provider && detected !== provider)) {
    throw new Error('Expected a GitLab /group/project/-/merge_requests/123 or GitHub /owner/repo/pull/123 URL.');
  }
  const match = detected === 'gitlab' ? gitlab! : github!;
  const project = decodeURIComponent(match[1]!);
  if (project.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid project path.');
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid review number.');
  return { provider: detected, origin: url.origin, project, number,
    url: `${url.origin}/${match[1]}${detected === 'gitlab' ? '/-/merge_requests/' : '/pull/'}${number}` };
}

export function tokenCreationUrl(provider: Provider, baseUrl: string): string {
  const base = serviceUrl(baseUrl).toString().replace(/\/$/, '');
  return provider === 'gitlab'
    ? `${base}/-/user_settings/personal_access_tokens?name=Change%20Stack%20Local&scopes=read_api`
    : `${base}/settings/personal-access-tokens/new`;
}

export function gitApiBase(host: { provider: Provider; baseUrl: string }): string {
  const base = serviceUrl(host.baseUrl).toString().replace(/\/$/, '');
  return host.provider === 'gitlab' ? `${base}/api/v4` : new URL(base).hostname === 'github.com'
    ? 'https://api.github.com' : `${base}/api/v3`;
}
