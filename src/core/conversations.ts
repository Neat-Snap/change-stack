import { gitApiBase, serviceUrl } from './target';
import { serviceJson } from './network';
import { ServiceError } from './diagnostics';
import type { Conversation, HostConfig, Review, ReviewThread, ThreadComment } from './types';

export class ConversationError extends Error {}
export interface ConversationService {
  load(): Promise<Conversation>;
  reply(thread: ReviewThread, body: string): Promise<void>;
  resolve(thread: ReviewThread, resolved: boolean): Promise<void>;
  comment(body: string): Promise<void>;
}
const pageLimit = 100;
const commentFields = 'id databaseId body createdAt url diffHunk author { login }';
export const githubThreadsQuery = `query ReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    headRefOid baseRefOid reviewThreads(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor } nodes {
        id path line startLine originalLine originalStartLine diffSide startDiffSide isResolved isOutdated viewerCanReply viewerCanResolve viewerCanUnresolve resolvedBy { login }
        comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${commentFields} } }
      }
    }
  } }
}`;

export function conversationService(review: Review, host: HostConfig): ConversationService {
  if (serviceUrl(host.baseUrl).origin !== review.target.origin || host.provider !== review.target.provider) throw new ConversationError('Credentials do not match this review host.');
  const api = gitApiBase(host), origin = new URL(api).origin;
  const headers: Record<string, string> = host.provider === 'gitlab' ? { 'PRIVATE-TOKEN': host.token } : { Authorization: `Bearer ${host.token}`, Accept: 'application/vnd.github+json' };
  const prefix = new URL(host.baseUrl).pathname.replace(/^\/|\/$/g, '');
  const gitlabProject = prefix && review.target.project.startsWith(`${prefix}/`) ? review.target.project.slice(prefix.length + 1) : review.target.project;
  const base = host.provider === 'gitlab'
    ? `/projects/${encodeURIComponent(gitlabProject)}/merge_requests/${review.target.number}`
    : `/repos/${review.target.project.split('/').map(encodeURIComponent).join('/')}`;
  const prBase = host.provider === 'gitlab' ? base : `${base}/pulls/${review.target.number}`;
  const issueBase = `${base}/issues/${review.target.number}`;
  const graphqlUrl = new URL(host.baseUrl).hostname === 'github.com' ? 'https://api.github.com/graphql' : `${host.baseUrl.replace(/\/$/, '')}/api/graphql`;

  async function guarded<T>(operation: () => Promise<T>, write = false): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ConversationError) throw error;
      if (error instanceof ServiceError) {
        if ([401, 403, 404].includes(error.status)) throw new ConversationError(`The Git service refused conversation access (HTTP ${error.status}). Check your saved token, repository access, and comment permissions.`);
        if (error.status === 429) throw new ConversationError('The Git service is rate limiting requests. Wait before refreshing again.');
        if ([400, 409, 422].includes(error.status)) throw new ConversationError('The Git service rejected this conversation action. Refresh the conversation and try again.');
      }
      throw new ConversationError(write ? 'Could not confirm whether the conversation was updated. Check the original review before trying again.' : 'Could not refresh the conversation. Your last loaded comments are still shown.');
    }
  }
  const get = <T>(path: string) => serviceJson<T>(api + path, origin, { headers });
  const write = (path: string, method: string, body: unknown) => serviceJson<any>(api + path, origin, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function pages(path: string): Promise<any[]> {
    const result: any[] = [];
    for (let page = 1; page <= pageLimit; page++) {
      const batch = await get<any[]>(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new ConversationError('The Git service returned an invalid conversation response.');
      result.push(...batch);
      if (batch.length < 100) return result;
    }
    throw new ConversationError('This conversation exceeds the supported page limit. Open the original review to read it in full.');
  }
  async function graphql(query: string, variables: Record<string, unknown>): Promise<any> {
    const result = await serviceJson<any>(graphqlUrl, new URL(graphqlUrl).origin, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (result.errors?.length || !result.data) throw new ConversationError('GitHub could not complete this conversation request. Check token access and whether your GitHub version supports review threads.');
    return result.data;
  }
  const gitlabComment = (note: any): ThreadComment => ({ id: String(note.id), author: note.author?.username ?? 'Deleted user', body: note.body ?? '', createdAt: note.created_at, url: `${review.target.url}#note_${note.id}` });
  const githubComment = (note: any): ThreadComment => ({ id: note.id, author: note.author?.login ?? 'Deleted user', body: note.body ?? '', createdAt: note.createdAt, url: note.url });

  return {
    load: () => guarded(async () => {
      const threads: ReviewThread[] = [];
      let reviewChanged = false;
      if (host.provider === 'gitlab') {
        const current = await get<any>(prBase);
        reviewChanged = current.diff_refs?.head_sha !== review.headSha || current.diff_refs?.base_sha !== review.baseSha || current.diff_refs?.start_sha !== (review.startSha ?? review.baseSha);
        for (const discussion of await pages(`${base}/discussions`)) {
          const notes = (discussion.notes ?? []).filter((note: any) => !note.system);
          if (!notes.length) continue;
          const first = notes[0], pos = first.position;
          const line = pos?.new_line ?? pos?.old_line;
          const resolved = notes.filter((note: any) => note.resolvable).every((note: any) => note.resolved);
          threads.push({ id: String(discussion.id), kind: pos ? 'diff' : 'discussion', individual: !!discussion.individual_note,
            comments: notes.map(gitlabComment), resolved: !!first.resolvable && resolved, resolvable: !!first.resolvable,
            canResolve: !!first.resolvable, canReply: !discussion.individual_note, resolvedBy: first.resolved_by?.username,
            outdated: !!pos && (reviewChanged || (pos.head_sha && pos.head_sha !== review.headSha)),
            ...(line ? { position: { path: pos.new_line ? pos.new_path : pos.old_path, line, side: pos.new_line ? 'current' : 'old',
              ...(pos.line_range?.start ? { startLine: pos.line_range.start.new_line ?? pos.line_range.start.old_line, startSide: pos.line_range.start.type === 'old' ? 'old' : 'current' } : {}) } } : {}),
          });
        }
      } else {
        const [owner, name] = review.target.project.split('/');
        let after: string | undefined;
        for (let page = 0; page < pageLimit; page++) {
          const data = await graphql(githubThreadsQuery, { owner, name, number: review.target.number, after });
          const pr = data.repository?.pullRequest;
          if (!pr) throw new ConversationError('GitHub could not find this pull request with the saved token.');
          reviewChanged ||= pr.headRefOid !== review.headSha || (!!review.targetSha && pr.baseRefOid !== review.targetSha);
          for (const node of pr.reviewThreads.nodes) {
            const comments = [...node.comments.nodes];
            let connection = node.comments;
            for (let part = 0; connection.pageInfo.hasNextPage; part++) {
              if (part >= pageLimit) throw new ConversationError('A thread exceeds the supported page limit. Open the original review to read it in full.');
              const result = await graphql(`query ThreadComments($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReviewThread { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${commentFields} } } } } }`, { id: node.id, after: connection.pageInfo.endCursor });
              connection = result.node?.comments;
              if (!connection) throw new ConversationError('GitHub could not load all replies for this thread.');
              comments.push(...connection.nodes);
            }
            if (!comments.length) continue;
            const outdated = node.isOutdated || reviewChanged;
            const line = outdated ? node.originalLine ?? node.line : node.line;
            const startLine = outdated ? node.originalStartLine ?? node.startLine : node.startLine;
            threads.push({ id: node.id, kind: 'diff', comments: comments.map(githubComment), resolved: node.isResolved, resolvable: true,
              canResolve: node.isResolved ? node.viewerCanUnresolve : node.viewerCanResolve, canReply: node.viewerCanReply,
              resolvedBy: node.resolvedBy?.login, outdated, replyId: comments[0].databaseId, path: node.path, diffHunk: comments[0].diffHunk,
              ...(line ? { position: { path: node.path, line, side: node.diffSide === 'LEFT' ? 'old' : 'current', startLine: startLine ?? undefined, startSide: node.startDiffSide === 'LEFT' ? 'old' : 'current' } } : {}) });
          }
          if (!pr.reviewThreads.pageInfo.hasNextPage) break;
          after = pr.reviewThreads.pageInfo.endCursor;
          if (page === pageLimit - 1) throw new ConversationError('This conversation exceeds the supported page limit. Open the original review to read it in full.');
        }
        const general = await pages(`${issueBase}/comments`);
        for (const note of general) threads.push({ id: `issue:${note.id}`, kind: 'discussion', resolved: false, resolvable: false, canResolve: false, canReply: true,
          comments: [{ id: String(note.id), author: note.user?.login ?? 'Deleted user', body: note.body ?? '', createdAt: note.created_at, url: note.html_url }] });
        for (const note of await pages(`${prBase}/reviews`)) {
          if (!note.body?.trim() || note.state === 'PENDING') continue;
          threads.push({ id: `review:${note.id}`, kind: 'review', reviewState: note.state, resolved: false, resolvable: false, canResolve: false, canReply: true,
            comments: [{ id: String(note.id), author: note.user?.login ?? 'Deleted user', body: note.body, createdAt: note.submitted_at, url: note.html_url }] });
        }
      }
      return { threads: threads.sort((a, b) => a.comments[0].createdAt.localeCompare(b.comments[0].createdAt)), fetchedAt: new Date().toISOString(), reviewChanged };
    }),
    reply: (thread, body) => guarded(async () => {
      if (!thread.canReply) throw new ConversationError('Reply in the original review, or start a new discussion.');
      if (host.provider === 'gitlab') await write(`${base}/discussions/${encodeURIComponent(thread.id)}/notes`, 'POST', { body });
      else if (thread.kind === 'diff') {
        if (!thread.replyId) throw new ConversationError('The original comment for this thread is unavailable. Refresh the conversation.');
        await write(`${prBase}/comments/${thread.replyId}/replies`, 'POST', { body });
      } else await write(`${issueBase}/comments`, 'POST', { body });
    }, true),
    resolve: (thread, resolved) => guarded(async () => {
      if (!thread.resolvable || !thread.canResolve) throw new ConversationError('You do not have permission to change this thread’s resolution.');
      if (host.provider === 'gitlab') await write(`${base}/discussions/${encodeURIComponent(thread.id)}`, 'PUT', { resolved });
      else await graphql(`mutation ResolveThread($id: ID!) { ${resolved ? 'resolveReviewThread' : 'unresolveReviewThread'}(input: { threadId: $id }) { thread { id isResolved } } }`, { id: thread.id });
    }, true),
    comment: body => guarded(async () => { await write(host.provider === 'gitlab' ? `${base}/discussions` : `${issueBase}/comments`, 'POST', { body }); }, true),
  };
}
