# Change Stack

A minimal local review workspace for GitLab (including self-hosted instances) and GitHub (including Enterprise), built with TypeScript, Bun, React, shadcn/ui, Tailwind CSS, and Pierre's `@pierre/diffs` and `@pierre/trees`.

## Run

```sh
bun install --frozen-lockfile
bun run demo
# Or start with a real review:
bun src/cli.ts 'https://gitlab.company.internal/team/project/-/merge_requests/123'
```

On first run without a URL, choose GitLab or GitHub and paste a review URL. The CLI infers the host, asks you to confirm the service base URL, opens its token creation page, and accepts a hidden token input. It verifies your credentials before saving them. For GitLab, use a personal access token with `read_api`. For GitHub, use a fine-grained token with access to the repository and **Pull requests: Read** and **Contents: Read**; your organization may need to approve it.

Then optionally configure your company's OpenAI-compatible API **base URL** (including `/v1` when required), model ID, and API key. The client appends `/chat/completions`; it does not assume a model name or an external default endpoint. Setup can be skipped to use local path-based groups and the diff viewer without AI.

OpenRouter is supported at `https://openrouter.ai/api/v1`. Setting the model to `openai/gpt-6-luna` in setup uses high reasoning and Flex processing. The client sends OpenRouter's `reasoning.effort` and top-level `service_tier`, restricts routing to OpenAI with provider fallback disabled, and accepts model output only when the response confirms `service_tier: "flex"`. Other compatible endpoints can use optional `reasoningEffort` (`high`, `xhigh`, or `max`) and `serviceTier` (`flex`) fields in the local AI configuration. Flex requests allow up to ten minutes and do not retry at a different tier. Temperature is omitted for reasoning requests.

Subsequent runs need only the review URL:

```sh
cstack 'https://gitlab.company.internal/team/project/-/merge_requests/123'
cstack 'https://github.company.internal/team/project/pull/123'
```

Each Git host has separate saved credentials. To replace credentials or configure AI later, use `--setup` with a review URL. `--no-ai` skips the model even when it is configured. `--no-open` prints URLs without opening a browser. `--port 4317` sets a fixed local port; otherwise the OS chooses a free port. `--demo` loads illustrative sample changes without making outbound application requests. Keep the terminal open while reviewing; Ctrl+C shuts down the server.

## Explanation settings

The default prompt asks for simple language, short sentences, and only useful detail. Use English (`en`, the default) or Russian (`ru`):

```sh
cstack 'https://github.company/team/project/pull/123' --language ru
cstack 'https://github.company/team/project/pull/123' --system-prompt-file ./review-prompt.txt
cstack 'https://github.company/team/project/pull/123' --system-prompt 'Explain each change in everyday language.'
```

Prompt and `--language` flags apply to this run. Save a default without providing a PR URL:

```sh
cstack --default-language ru
cstack '<review-url>' --language en  # override for this review only
```

First-run setup stores everything in `~/.change-stack/`: `config.json` contains Git/model credentials, endpoint settings, budgets, and `defaultLanguage`; `system-prompt.md` contains the editable default prompt. Edit the Markdown file to change the prompt for future reviews. `--system-prompt` and `--system-prompt-file` override it for one run. The language and untrusted-code instructions are appended. Prompts must be nonempty and at most 16,000 characters. Existing settings are automatically copied from the previous `~/.config/change-stack/config.json` location (or its XDG equivalent), preserving credentials and preferences; the old file is left intact.

PR summaries can use unchanged files anywhere in the source repository. The model chooses read-only `list_files` / `read_file` requests through a validated JSON protocol, compatible with endpoints that do not support native function calling. Reads use the PR's head commit, including forked source repositories. There is no shell execution or cloning.

Exploration stops after two planning rounds or six tool calls, whichever comes first, then makes one final summary call. Every tool call makes at most one Git API request. Directory listings return at most 100 entries; GitLab can request the next page. Reads are limited to 512 KB of response data and 24,000 text characters per file. This is selective repository exploration, not a full repository audit. Layer generation is separately capped at 12 calls; further batches keep unexplained change ranges. There are no automatic retries.

You can lower the budgets:

```sh
cstack 'https://github.company/team/project/pull/123' \
  --max-tool-calls 2 --max-context-chars 24000 --max-output-tokens 16000
```

`--max-tool-calls` accepts 0–20 (0 skips repository reads but still generates a PR summary), `--max-context-chars` accepts 8,000–200,000 (default 48,000 user-message characters), and `--max-output-tokens` accepts 1,000–32,000. Output tokens include reasoning; reasoning models default to 16,000, so very small limits can prevent a usable answer. System prompt text is separate from the input character budget. Saved defaults use `maxToolCalls`, `maxContextChars`, and `maxOutputTokens` in `ai`. Repository or model failures retain the available layer summaries and show a warning.

## Build a binary

```sh
bun run build
./dist/cstack --demo
```

The binary embeds the Bun runtime and browser assets. End users do not need Bun, Node, or a package install. Build on the target platform or cross-compile with Bun:

```sh
bun build --compile --target=bun-linux-x64 src/cli.ts --outfile dist/cstack-linux-x64
bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile dist/cstack-macos-arm64
bun build --compile --target=bun-windows-x64 src/cli.ts --outfile dist/cstack-windows-x64.exe
```

Builds download dependencies from npm; the shipped application does not. Distribute third-party license notices with the binary; generate `dist/THIRD_PARTY_NOTICES.txt` with `bun run notices` after building.

## Review UI

- Logical review layers anchored to changed patch rows. A file and even one edit block can contribute to several layers. The model can combine ranges across files; exact range validation rejects invented or overlapping assignments and keeps unassigned edits in an additional layer. Generation uses bounded batches and calls; local groups remain available without AI.
- A small shadcn sidebar for switching layers and files, with an accessible mobile drawer and extension-specific file icons. Layers and the file tree collapse independently; each has its own scroll area, and long layer lists leave space for the tree. Distinct Layers and Files headers have their collapse arrows on the right; full-width backgrounds and subtle horizontal borders separate the sections. The tree has no extra outer indentation; folder depth supplies its hierarchy. A/M/D/R markers identify added, modified, deleted, and renamed files. Layer hover tooltips are removed. Previous/next controls in the main header navigate layers even when their list is collapsed.
- Pierre's file tree and syntax-highlighted split/unified diffs. Each layer opens directly to its changes. The diff pane is flat and compact, with sticky file headers, icon-based display controls, and immediate file jumps. Code rendering is limited to a window around the viewport to reduce DOM work on long patches. File headers remain available throughout the list.
- Four selectable themes: GitHub dark/light and GitLab dark/light. The initial GitHub theme follows your system preference. All theme assets are local.
- Each layer shows a short explanation in a bordered Markdown box above its diffs; All changes shows the whole PR summary. Lists, emphasis, inline code, code blocks, and tables are supported. Raw HTML and external images are not loaded.
- Each file has a Reviewed checkbox. Checking it collapses the diff while retaining its file header. Reviewed state stays consistent across layers during the current browser session. You can expand a reviewed file without unchecking it.
- File tree clicks scroll to the chosen file without hiding other files. Sidebar selection changes color while keeping the same font weight.
- No branding, permanent chat, notes, or status dashboard in the review workspace.
- Warnings when service responses omit file content or pagination is capped.

## Search and keyboard navigation

The search button, `Cmd/Ctrl+K`, `/`, or `?` opens search over loaded file paths, diff text, and layer summaries. Up to 100 results are displayed. Arrow keys select a result; Enter opens it and Escape closes search. Selecting a diff match opens All changes, expands the file, and highlights its source line while preserving the complete review. Search runs locally and makes no model calls.

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous layer |
| `l` / `h` | Next / previous file in the current view |
| `u` | Toggle split/unified |
| `[` | Toggle sidebar |
| `Cmd/Ctrl+K`, `/`, `?` | Search |
| `Esc` | Close search or symbol lookup |

Letter shortcuts are ignored while typing or while a dialog is open. Native tree and dialog arrow navigation remain available.

## Context and symbols

For modified/renamed files, **+20 context lines** loads old/current text at the review's pinned commits and expands equal surrounding lines. Repeated clicks expand up to 200 extra lines; Reset context restores the compact patch. Expansion stops at other edits, so changes from another layer are not silently included. GitHub old content uses the compare API's merge base; GitLab uses its diff base. If that commit or file content is unavailable, context cannot be expanded. Binary/oversized files remain readable only through the available patch.

**Alt-click a highlighted symbol**, or use the small symbol lookup button in a file header, to inspect definitions and references without leaving the page. Lookup searches the pinned PR head, prioritizing the current/changed files and nearby directories. It is a bounded text search with heuristic definition labels, not a language server or a complete repository index. The dialog reports searched/unavailable files and search limits, shows surrounding lines, and can jump back to changed files.

Repository lookup scans at most 24 files and lists at most four directories per request. Files are limited to 250,000 text characters and 512 KB of API response data; oversized reads fail instead of returning misleading partial context. A bounded 24-entry cache lives only in process memory. Two concurrent UI lookup requests are allowed. Browser requests go to the local authenticated API; only the server contacts the configured Git service. No additional AI calls or services are involved.

## Data handling

The CLI service binds only to `127.0.0.1`. Its API requires a random session cookie, exchanged using the secret in the CLI's launch URL fragment. Mutation requests must have the same browser origin. The fragment is removed from browser history after authentication. The development preview script can explicitly bind to a Tailscale interface and accept an explicitly configured proxy origin; this does not change the CLI's default.

Application requests go only to the selected Git service API and the explicitly configured model endpoint. Public GitHub uses `api.github.com`; GitHub Enterprise uses the selected host's `/api/v3`; GitLab uses its `/api/v4`. Redirects are rejected, including same-host redirects, so fix the configured URL rather than relying on a redirect. The application does not fetch links, images, or instructions from repository content. There is no telemetry, CDN, external font, cloud fallback, or update check. Opening the original review or token page navigates your browser to the Git host you selected.

Credentials are stored **in plaintext** at `~/.change-stack/config.json`, with file mode `0600` on POSIX; the settings directory is created with mode `0700`. The editable `system-prompt.md` file also uses mode `0600`. Override the path with `CHANGE_STACK_CONFIG`. Windows requires an appropriate user-only filesystem ACL; POSIX mode bits do not provide equivalent access control there. OS keychain integration is not implemented. Delete `~/.change-stack/` to remove settings and saved credentials. If settings were migrated, also remove the old configuration file to erase its retained copy.

Source patches, reviewed-file state, and analysis are held in process/browser memory. They are not written to a database or browser storage. Sidebar state is also held in memory. This application cannot control retention by your model endpoint, Git service, operating system, or browser. HTTPS and trusted corporate certificates are recommended; certificate verification is never disabled by this app. Configure corporate CAs through the runtime/OS trust mechanism available in your deployment.

## Current limits

This is a working first version, not full Change Stack parity. It reads supplied diffs and selected unchanged repository files; it does not clone repositories, build a full dependency graph, generate diagrams, synchronize discussions, publish comments, or approve/merge reviews. Model explanations are hypotheses for human review, not merge decisions. Very large patches are shortened for the model and explicitly identified. Layers are ordered within batches; the PR summary combines layer explanations and bounded repository context.

The UI opens after fetch and explanation preparation; long reviews may take several model calls. Interrupted or failed batches retain their change ranges in unexplained groups. This implementation uses `/chat/completions` with standard non-streaming chat messages; endpoints requiring a different API need an adapter. Pierre Trees is pinned to a beta release. Hosted multiuser deployment is outside this version's scope.

## Validate

```sh
bun run typecheck
bun run test
bun run build
bunx playwright install --with-deps chromium
bun run test:ui
```

Tests use local mock services for host isolation, redirect refusal, credential permissions, provider pagination, snapshot consistency, model grounding/fallback, and local session authentication.

The UI smoke check launches the compiled binary outside the project directory and checks the shadcn layout, layer navigation, both Pierre components, split/unified rendering, mobile navigation, and absence of external requests. Browser downloads are development tools, not part of the shipped binary. Use `CHANGE_STACK_CHROMIUM` to point the test at an existing compatible Chromium executable. Tailwind is compiled to a local stylesheet before development, tests, and executable builds; `bun run styles` generates it separately when needed.

UI comparison notes and scope: [Diffshub comparison](docs/ui-comparison.md), [CodeRabbit feature comparison](docs/change-stack-feature-comparison.md).
