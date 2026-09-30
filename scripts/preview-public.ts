import { reviewTools } from '../src/core/review-tools';
import { fetchReview } from '../src/core/providers';
import { repositoryReader } from '../src/core/repository';
import { parseTarget } from '../src/core/target';
import { analyze, localAnalysis } from '../src/core/analysis';
import { loadConfig } from '../src/core/config';
import { startServer } from '../src/server';

const target = parseTarget(Bun.argv[2] ?? 'https://github.com/oven-sh/bun/pull/44171');
// Reuse existing local gh authentication without printing or persisting the token.
const auth = Bun.spawn(['gh', 'auth', 'token', '--hostname', new URL(target.origin).hostname], { stdout: 'pipe', stderr: 'ignore' });
const token = (await new Response(auth.stdout).text()).trim();
if (await auth.exited !== 0 || !token) throw new Error('GitHub CLI authentication is required for this development preview.');
const review = await fetchReview(target, { provider: target.provider, baseUrl: target.origin, token });
const ai = process.env.CHANGE_STACK_PREVIEW_AI === 'true' ? (await loadConfig()).ai : undefined;
if (process.env.CHANGE_STACK_PREVIEW_AI === 'true' && !ai) throw new Error('No model configuration found.');
if (ai) console.log(`Preparing layers with ${ai.model}, ${ai.reasoningEffort} reasoning, ${ai.serviceTier} tier…`);
const analysis = ai ? await analyze(review, ai, repositoryReader(review, { provider: target.provider, baseUrl: target.origin, token })) : localAnalysis(review);
if (ai && analysis.source !== 'model') throw new Error(`Model preparation failed: ${analysis.warnings.join(' ')}`);
const { server, url } = startServer({ review, analysis, aiEnabled: !!ai, demo: false }, ai,
  Number(process.env.CHANGE_STACK_PREVIEW_PORT ?? '4317'), process.env.CHANGE_STACK_PUBLIC_ORIGIN,
  process.env.CHANGE_STACK_PREVIEW_HOST ?? '127.0.0.1', reviewTools(review, { provider: target.provider, baseUrl: target.origin, token }));
console.log(`Review ready: ${url}`);
console.log(`${review.title} · ${review.files.length} files · ${analysis.layers.length} layers · ${ai ? 'Model-generated, requested tier verified' : 'AI disabled'}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); process.exit(0); });
