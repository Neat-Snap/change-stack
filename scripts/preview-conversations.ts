import { demoSession } from '../src/core/demo';
import { demoConversations } from '../src/core/demo-conversations';
import { addDiffAnchors, makePatch } from '../src/core/providers';
import { parseTarget } from '../src/core/target';
import { startServer } from '../src/server';
import { localAnalysis } from '../src/core/analysis';
import { wholeRanges } from '../src/core/changes';
import type { Review } from '../src/core/types';

// Public PR source; all layers and conversations in this preview are samples.
export async function conversationPreview(port = 0) {
  const source = 'https://api.github.com/repos/sindresorhus/p-limit/pulls/109';
  async function publicData(name: string, url: string) {
    const cached = Bun.file(`dist/${name}.json`);
    if (await cached.exists()) return cached.json();
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Could not load public preview PR: HTTP ${response.status}`);
    const data = await response.json(); await Bun.write(cached, JSON.stringify(data)); return data;
  }
  const metadata = await publicData('public-review', source), files = await publicData('public-review-files', `${source}/files`);
  const review: Review = addDiffAnchors({ target: parseTarget(metadata.html_url), title: metadata.title + ' · preview', description: metadata.body ?? '', author: metadata.user.login,
    sourceBranch: metadata.head.ref, targetBranch: metadata.base.ref, headSha: metadata.head.sha, targetSha: metadata.base.sha, warnings: [],
    files: files.map((file: any) => ({ path: file.filename, oldPath: file.previous_filename ?? file.filename, status: file.status === 'added' ? 'added' : 'modified',
      patch: makePatch(file.previous_filename ?? file.filename, file.filename, file.status === 'added' ? 'added' : 'modified', file.patch ?? ''), additions: file.additions, deletions: file.deletions, incomplete: false })) });
  const session = { ...demoSession(), review, demo: true, commentsEnabled: true, conversationsEnabled: true, analysis: { ...localAnalysis(review),
    summary: 'Exposes clearQueue() on limited functions and documents pending-promise behavior. This preview uses a public PR diff with sample layers and conversations.',
    layers: [
      { id: 'implementation', title: 'Expose queue control', category: 'Implementation', summary: 'Attaches the existing limiter’s clearQueue method to the returned callable function. Open and resolved discussions are attached to the changed lines.', files: ['index.js', 'index.d.ts'] },
      { id: 'tests', title: 'Regression and type coverage', category: 'Tests', summary: 'Checks the runtime queue behavior and preserves the callable TypeScript signature.', files: ['test.js', 'index.test-d.ts'], dependsOn: ['implementation'] },
      { id: 'docs', title: 'Document the promise lifecycle', category: 'Documentation', summary: 'Explains how clearing pending calls differs from cancelling work already running.', files: ['readme.md'], dependsOn: ['implementation'] },
    ].map(layer => ({ ...layer, ranges: wholeRanges(review.files.filter(file => layer.files.includes(file.path))) })) } };
  const mock = demoConversations(review);
  const result = startServer(session, undefined, port, undefined, '127.0.0.1', undefined, mock.comment, mock.service);
  return { ...result, mock, session };
}
if (import.meta.main) {
  const result = await conversationPreview(4320);
  console.log(`Conversation preview (sample threads and layers): ${result.url}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { result.server.stop(true); process.exit(0); });
}
