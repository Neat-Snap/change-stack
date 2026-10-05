import { analyze, localAnalysis } from './analysis';
import { ideAnalysis } from './ide-export';
import { fetchReview } from './providers';
import { repositoryReader } from './repository';
import { parseTarget, serviceUrl } from './target';
import { loadConfig } from './config';
import { diagnosticReason } from './diagnostics';
import type { AIConfig, HostConfig } from './types';

// Private stdin/stdout protocol for the IDE. Tokens never enter argv, files, or logs.
export async function runIdeRequest(input: unknown, progress: (message: string) => void = () => {}) {
  const value = input as { version?: number; url?: string; host?: HostConfig; ai?: AIConfig; expectedHeadSha?: string; local?: boolean };
  if (value?.version !== 1 || typeof value.url !== 'string') throw new Error('Invalid IDE request.');
  const target = parseTarget(value.url, 'gitlab');
  const host = value.host;
  if (!host || host.provider !== 'gitlab' || typeof host.token !== 'string' || !host.token.trim()
    || serviceUrl(host.baseUrl).origin !== target.origin) throw new Error('Invalid GitLab account.');
  const ai = value.local ? undefined : value.ai ?? (await loadConfig()).ai;
  if (!value.local && !ai) throw new Error('Configure an analysis model in Change Stack settings first.');
  if (ai) {
    serviceUrl(ai.baseUrl);
    if (!ai.model?.trim() || !ai.apiKey?.trim()) throw new Error('Incomplete model settings.');
  }
  progress('Loading merge request and changed files');
  const review = await fetchReview(target, host, progress);
  if (value.expectedHeadSha && review.headSha !== value.expectedHeadSha) throw new Error('The merge request changed. Refresh it in GitLab and analyze again.');
  progress('Preparing semantic review');
  const analysis = ai ? await analyze(review, ai, repositoryReader(review, host), progress) : localAnalysis(review);
  analysis.warnings = analysis.warnings?.map(warning => warning.replace(
    'TLS certificate verification failed. Check your corporate CA certificate (CHANGE_STACK_CA_FILE).',
    'TLS certificate verification failed. Choose your corporate CA bundle in Change Stack → Analysis settings, or enable automatic Nessy certificate detection.'));
  return ideAnalysis({ review, analysis, aiEnabled: !!ai, demo: false });
}

export async function ideRequestMain() {
  try {
    const input = await Bun.stdin.text();
    if (input.length > 1_000_000) throw new Error('IDE request is too large.');
    const snapshot = await runIdeRequest(JSON.parse(input), message => console.error(JSON.stringify({ progress: message })));
    console.log(JSON.stringify({ ok: true, snapshot }));
  } catch (error) {
    // Known protocol errors are useful; arbitrary transport/model exceptions can contain secrets.
    const known = ['Invalid IDE request.', 'Invalid GitLab account.', 'Configure an analysis model in Change Stack settings first.',
      'Incomplete model settings.', 'The merge request changed. Refresh it in GitLab and analyze again.', 'IDE request is too large.'];
    const reason = diagnosticReason(error);
    const message = error instanceof Error && known.includes(error.message) ? error.message
      : reason.startsWith('TLS certificate verification failed.')
        ? 'TLS certificate verification failed. Open Change Stack → Analysis settings and choose your corporate CA bundle (.crt / .pem). The Nessy bundle can be detected automatically.'
        : reason !== 'The request failed. Check service connectivity or retry with --debug.'
          ? `Analysis failed. ${reason} Check Change Stack analysis settings. Native GitLab review is still available.`
          : 'Analysis failed. Check GitLab access, model settings, and connectivity. Native GitLab review is still available.';
    console.log(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}
