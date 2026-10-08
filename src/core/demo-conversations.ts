import type { CommentInput, Conversation, Review, ReviewThread, ThreadComment } from './types';
import { ConversationError, type ConversationService } from './conversations';

// Sample conversations never write to a Git provider.
export function demoConversations(review: Review) {
  const main = review.files.find(file => file.path === 'index.js') ?? review.files[0];
  const tests = review.files.find(file => /(?:test|spec)/.test(file.path)) ?? review.files[1] ?? main;
  const docs = review.files.find(file => /readme/i.test(file.path)) ?? main;
  const start = (patch: string) => Number(/@@ .* \+(\d+)/.exec(patch)?.[1] ?? 1);
  const now = Date.now();
  let serial = 0, failRead = false;
  const comment = (author: string, body: string, minutes = 35): ThreadComment => ({ id: `sample-comment-${++serial}`, author, body,
    createdAt: new Date(now - minutes * 60_000 + serial * 1000).toISOString(), url: review.target.url });
  const thread = (id: string, comments: ThreadComment[], path?: string, line?: number, resolved = false): ReviewThread => ({ id, comments, kind: path ? 'diff' : 'discussion', resolved,
    resolvable: !!path, canResolve: !!path, canReply: true, ...(resolved ? { resolvedBy: 'alex' } : {}), ...(path && line ? { position: { path, line, side: 'current' } } : {}) });
  const threads: ReviewThread[] = [
    thread('sample-discussion', [comment('alex', 'Ready for another look. This exposes `clearQueue()` on the limited function without changing how active calls run.\n\nThe implementation, type definitions, and regression tests are split into separate reading layers.', 50), comment('maya', 'Thanks! I’ll focus on the queue lifecycle and the TypeScript return type.', 44)]),
    thread('sample-open', [comment('maya', 'Should this delegate to the **same limiter instance**? We need to make sure clearing the queue doesn’t accidentally affect calls already running.'), comment('alex', 'Yes, the property points directly to `limit.clearQueue`, so both paths share the queue. Running tasks keep their original promises.', 29), comment('ilya', 'That makes sense. Can we make the active-task behavior explicit in the regression test as well?', 23)], main.path, start(main.patch) + 5),
    thread('sample-resolved', [comment('noah', 'Could the docs explicitly say that clearing the queue does **not cancel already-running calls**?', 38), comment('alex', 'Added that distinction to the README, together with the `rejectOnClear` behavior.', 26)], main.path, start(main.patch) + 8, true),
    thread('sample-single', [comment('maya', 'Please also cover `rejectOnClear: false`, so the default behavior is documented by a test.', 18)], tests.path, start(tests.patch) + 4),
    thread('sample-long', [comment('noah', 'There are a few different lifecycles here. I’d like us to be precise about which promises settle when the queue is cleared.\n\n```js\nconst limited = limitFunction(work, {\n  concurrency: 1,\n  rejectOnClear: true,\n});\nconst running = limited("first");\nconst queued = limited("second");\nlimited.clearQueue();\n```\n\nThe running promise should settle normally. The queued promise should reject with `AbortError`. When `rejectOnClear` is false, the queued promise intentionally stays pending.\n\nFor callers awaiting `Promise.all`, that difference matters: the default mode can leave the whole aggregate waiting indefinitely. It would help to show the recommended option before the lifecycle example.\n\nI’m also thinking about callbacks with nontrivial return values and whether the intersection type keeps the original argument inference. The examples should make it clear that this remains a regular callable function, with the queue method attached.\n\nFinally, please keep the cleanup guidance close to the example. Someone reading only the snippet should still understand why they might opt into rejected queued calls.', 40),
      comment('alex', 'Agreed on separating active calls from queued calls.', 35), comment('maya', 'The intersection type preserves argument inference in the type test.', 33), comment('noah', 'Great. Could we add a small usage example with teardown?', 30), comment('alex', 'Added a cleanup example and kept it next to the lifecycle description.', 28), comment('ilya', 'I checked both options locally. Active calls complete in either case.', 25), comment('maya', 'The default-mode test now explicitly documents the pending promises.', 21), comment('noah', 'One last detail: please use the actual error name in the README so callers can match it.', 15), comment('alex', 'Done — the example now checks `error.name === "AbortError"`.', 11)], docs.path, start(docs.patch) + 7),
    { ...thread('sample-outdated', [comment('ilya', 'This earlier version returned the limiter directly. Is the wrapper still needed?', 46), comment('alex', 'The implementation changed in the latest revision. Keeping the wrapper preserves the original call signature.', 41)], main.path, start(main.patch) + 1), outdated: true },
  ];
  const snapshot = (): Conversation => ({ threads: structuredClone(threads), fetchedAt: new Date().toISOString(), reviewChanged: false });
  const service: ConversationService = {
    async load() { if (failRead) { failRead = false; throw new ConversationError('Could not refresh the conversation. Your last loaded comments are still shown.'); } return snapshot(); },
    async reply(item, body) {
      await Bun.sleep(180);
      if (body === 'reject') throw new ConversationError('The Git service refused this reply. Your draft has been kept.');
      const existing = threads.find(thread => thread.id === item.id);
      if (!existing) throw new ConversationError('Thread no longer exists.');
      existing.comments.push(comment('you', body, 0));
    },
    async resolve(item, resolved) { await Bun.sleep(180); const existing = threads.find(thread => thread.id === item.id)!; existing.resolved = resolved; existing.resolvedBy = resolved ? 'you' : undefined; },
    async comment(body) { threads.push(thread(`sample-new-${++serial}`, [comment('you', body, 0)])); },
  };
  return { service, snapshot, failNextLoad: () => { failRead = true; }, externalReply: (id: string) => threads.find(thread => thread.id === id)!.comments.push(comment('alex', 'Added the regression test. Could you take another look?', 0)),
    async comment(input: CommentInput) { const created = thread(`sample-new-${++serial}`, [comment('you', input.body, 0)], input.path, input.end); created.position!.side = input.endSide ?? input.side; threads.push(created); return { url: review.target.url }; },
  };
}
