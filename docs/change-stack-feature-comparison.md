# CodeRabbit Change Stack feature comparison

Updated after implementing local search, keyboard navigation, range-based layers, context expansion, and bounded symbol lookup. Saved progress, freshness checks, and provider comments remain deferred.

Checked against the official Change Stack documentation on 2026-09-30 and our current source. This inventories the documented review workspace, including its integration entry points; it does not claim to inventory the entire CodeRabbit platform. Provider and plan restrictions apply to CodeRabbit features. Recommendations below are our judgment, not claims from CodeRabbit.

Status: **Yes** = available in our UI; **Partial** = a narrower version; **Missing** = absent; **Omitted** = deliberately excluded from our agreed UI.

## Structure and navigation

Source: [Overview](https://docs.coderabbit.ai/change-stack), [Navigation](https://docs.coderabbit.ai/change-stack/navigation), [product page](https://www.coderabbit.ai/change-stack).

| Feature | Our version |
| --- | --- |
| Logical layers spanning files and directories | Yes: model assigns changed-row ranges across files; generation remains bounded by batches. |
| Cohorts for independent groups of layers | Missing: one flat layer list. |
| Reading order and explicit dependencies | Partial: ordered list, no dependency model or global ordering pass. |
| Line ranges with attached summaries/findings | Partial: ranges drive layer diffs, including multiple layers per file; summaries attach to layers rather than individual ranges. No findings model. |
| PR overview and layer summaries | Yes: Markdown boxes above the diffs. |
| Layers and changed-file navigation | Yes: independently collapsible sections, extension icons, continuous diff scrolling. |
| Previous/next navigation | Yes: layer buttons and next/previous layer/file shortcuts. |
| Command palette and keyboard shortcuts | Partial: search palette, layer/file/layout/sidebar shortcuts; no action command catalog. |
| Responsive navigation and focus mode | Partial: mobile sidebar and sidebar toggle; no dedicated focus mode. |
| Search paths, diffs, source, summaries, comments | Partial: local search covers paths, patches, and layer summaries; no comment/source-content index. |
| Viewed-file progress | Partial: Reviewed collapses a file; survives layer switches, not reloads or process restarts. No progress counter/provider sync. |
| Deep links to views, layers, files, ranges | Missing: launch URL opens a session, not a specific review location. |
| Public share locators | Missing: local bearer session links are not a public sharing/access system. |
| Activity timeline | Missing. |
| Per-layer diagrams | Missing: no Mermaid rendering/generation. |
| Range summaries and comments panel | Partial: layer summary only; right panel intentionally removed. |

CodeRabbit supports diagram types suited to the change (class, sequence, flow, state, entity relationships). Its reviewed progress is snapshot-specific; GitHub Viewed state sync is provider-specific. Shared URLs can follow the latest snapshot or address a particular review run.

## Reading surface

Source: [Read changes](https://docs.coderabbit.ai/change-stack/reading-diffs).

| Feature | Our version |
| --- | --- |
| Semantic/entity diff with line-diff fallback | Missing: ordinary patches, no entity extraction or moved-code organization. |
| Split/unified layout | Yes. |
| Expand unchanged context; compact/context semantic views | Partial: +20 context controls fetch pinned old/current text and expand equal surrounding lines; no semantic mode. |
| Hide whitespace-only changes | Missing. |
| Blame lookup | Missing. |
| Code Peek definitions/references | Partial: Alt-click/manual lookup over up to 24 changed/nearby files, with snippets and heuristic definition labels. |
| Rendered document/source comparisons | Missing: Markdown summaries are supported, Markdown file diffs are not rendered. |
| Image comparisons and fit controls | Missing: non-text patches show a placeholder. |
| Collapse summaries by complexity | Missing: file collapse exists, range complexity does not. |
| Page/syntax themes and code fonts | Partial: four GitHub/GitLab themes; no separate theme/font selection or system setting. |
| Persistent appearance/filter/layout preferences | Missing: UI settings are in-memory. |
| Adjustable rail widths | Omitted: user explicitly canceled resize controls. |
| Large-change recovery and explicit limits | Partial: fetch limits/incomplete warnings and windowed code rendering; no GitHub raw-diff recovery. |

Code Peek and blame are best-effort provider lookups, not a complete language-server index. Semantic diff is independent of split/unified layout. Our Pierre virtualizer keeps code rendering bounded, but retains one file header/container per file.

## Findings and overview

Source: [Findings](https://docs.coderabbit.ai/change-stack/findings).

| Feature | Our version |
| --- | --- |
| Structured findings attached to code | Missing: model produces explanation and review questions, not anchored findings. Questions are currently not displayed. |
| Type, severity, category, effort/reward labels | Missing. |
| Severity and resolved/outdated/bot filters | Missing. |
| Attention queue: blockers, priority, pending, advisory | Missing. |
| Merge readiness with confidence and drivers | Missing. |
| Provider mergeability/status/checks | Missing in UI. |
| Finding comparison across review runs | Missing. |
| Live review progress and outcome states | Partial: CLI preparation output/loading view; no live review-run history. |
| Refresh graphs, regenerate summaries, recover reviews | Partial: rerun CLI; no targeted in-page regeneration. |
| Blast Radius dependency/consumer/test graph | Missing. |
| Architecture Impact graph and linked findings | Missing. |

CodeRabbit distinguishes its AI readiness assessment from provider mergeability. Finding categories/types/effort are labels; current documentation says they are not filter axes. Graphs come from CodeRabbit Security and may be absent while generation is disabled or incomplete.

## Provider review actions

Source: [Review and merge](https://docs.coderabbit.ai/change-stack/reviewing).

| Feature | Our version |
| --- | --- |
| Line/range selection and comment composer | Partial: Pierre line selection enabled; no composer or provider write. |
| File comments; edit/discard draft comments | Missing. |
| Reply, resolve, reopen threads | Missing: existing provider comments are not fetched. |
| Image attachment to comments | Missing. |
| Submit approval/comment/request changes | Missing. |
| Apply code suggestions | Missing. |
| Mark draft ready | Missing. |
| Direct merge/merge queue | Missing. |
| Coding Agent task from a finding | Missing. |
| Request CI/conflict repair | Missing. |
| Guard writes against changed head/base | Missing write workflow; fetching already rejects a head that changes during preparation. |

CodeRabbit writes under the reviewer's provider identity. Draft storage differs by provider, and CodeRabbit-held GitLab/Bitbucket drafts expire. Suggestion commits work on GitHub/GitLab; direct merge and queue controls are GitHub-only. Task offers depend on plan, write access, connection, and freshness. Our current credential flow and provider adapters are read-only.

## Snapshots and retention

Source: [Snapshots and freshness](https://docs.coderabbit.ai/change-stack/snapshots).

| Feature | Our version |
| --- | --- |
| Consistent commit-pinned review | Partial: captured head SHA and pinned model repository reads, held in one process. |
| Saved historical snapshots and selector | Missing: no review artifact storage. |
| Compare displayed head to current live head | Missing after initial preparation. |
| New snapshot notification/refresh | Missing. |
| Snapshot-specific links and review progress | Missing. |
| Generation provenance | Partial: model/local analysis source and warnings exist; no artifact history or repaired-stack state. |

Our in-memory review is stable until the process exits, but cannot be reopened as a historical artifact. Adding persistence must include configurable expiry and deletion to fit the original retention requirement. Saving settings and credentials is separate from saving repository code.

## Contextual chat

Source: [Chat](https://docs.coderabbit.ai/change-stack/chat).

| Feature | Our version |
| --- | --- |
| Snapshot-pinned questions about layer/file/range | Omitted from UI at user's request. Legacy server ask route is not a visible feature. |
| Thread history and reopening | Omitted. |
| Repository/connected-resource/web tool trace | Partial: bounded repository reads during summary preparation, no conversational trace. |
| Voice question transcription | Omitted. |
| Stop generation and message state handling | Omitted. |
| Start coding actions from an answer | Omitted. |

Keeping the persistent chat bar removed remains the product decision. An optional selection action could be considered later if requested. Our model preparation uses only the configured provider and AI services; web/resource search is not part of the review pipeline.

## Collaboration integrations

Source: [Slack and Discord collaboration](https://docs.coderabbit.ai/change-stack/notifications).

| Feature | Our version |
| --- | --- |
| Start/update Slack or Discord discussion | Missing. |
| Subscribe/unsubscribe to PR event delivery | Missing. |
| Event delivery for lifecycle, changes, conversations, CI/reviews | Missing. |
| Slack actions: ask, fix via commit/stacked PR, fix CI/comments, mark handled | Missing. |
| Autofix commit vs stacked-PR mode | Missing. |
| Close checklist: checks, merge state, requested changes, stale branch, unresolved comments | Missing. |

These connected-service features should be deferred for a local review tool. They bring additional credentials, state, and network destinations. Researching them here does not enable or contact messaging services.

## Providers

Source: [Provider support](https://docs.coderabbit.ai/change-stack/provider-support).

| Provider | Our version |
| --- | --- |
| GitHub and self-hosted GitHub | Yes: read paths and configured host tokens. |
| GitLab and self-hosted GitLab | Yes: nested projects, paginated patches, configured host tokens. |
| Bitbucket Cloud/Data Center | Missing. |
| Azure DevOps/self-hosted Azure | Missing. |

CodeRabbit's Azure artifacts are read-only. CodeRabbit's public anonymous sharing supports public GitHub/GitLab artifacts; Bitbucket requires authentication. Self-hosted support does not establish whether a product meets a particular company's retention policy.

## Recommended order

1. **Implemented: local search and keyboard navigation.** Index loaded paths, patches, and summaries in-browser; add command palette, next/previous file/layer, and navigation back. Good daily value without extra AI calls or outbound services.
2. **Implemented: range-based layers.** Extend model output with validated hunk/line references, permit one file to contribute to several layers, and reconcile batches into a global reading order. Preserve All changes as the complete diff. This addresses the main structural gap.
3. **Implemented: context expansion and Code Peek.** Load old/current content from approved provider origins at pinned commits. Start with bounded text lookup and a clear incomplete-results state; add language-aware indexing only if needed.
4. **Deferred by user: freshness and resumable review.** Compare head on demand; associate reviewed state with host/project/PR/head. Offer opt-in storage with retention and deletion controls rather than silently caching code.
5. **Deferred by user: provider comments and review submission.** Read threads first, then draft/reply/submit with explicit write setup and stale-head checks. This is the most useful collaboration addition for teammates reviewing each other's code.
6. **Small, evidence-linked review questions/findings.** Surface existing questions first. Add severity only with a validated code anchor and concise explanation. Avoid a large dashboard or a speculative merge-readiness score.
7. **Optional diagrams and rich file diffs.** Generate diagrams only when they clarify a flow; image/Markdown comparison is worthwhile for repositories that change those assets often.

Defer permanent chat, adjustable panes, Slack/Discord automation, coding-agent fixes, merge controls, and additional providers until a concrete need appears. They add surface area beyond the current minimal reader.

## Capabilities specific to our implementation

- A compiled Bun CLI opens a local shadcn/Pierre UI.
- User-configured OpenAI-compatible endpoint, model settings, and bounded repository exploration.
- English/Russian explanations, saved default language, editable Markdown system prompt.
- Credentials/settings in `~/.change-stack`, restricted configuration file permissions.
- Configured-origin network enforcement and redirect rejection; no remote browser assets required.
- Four requested GitHub/GitLab themes and continuous file navigation.

Implementation evidence: `src/web/app.tsx`, `src/web/summary.tsx`, `src/core/types.ts`, `src/core/analysis.ts`, `src/core/providers.ts`, `src/core/repository.ts`, `src/core/network.ts`, `src/core/config.ts`, `src/server.ts`, and `src/cli.ts`. UI omissions are based on rendered controls and handlers; backend scaffolding alone is not counted as a shipped user feature.
