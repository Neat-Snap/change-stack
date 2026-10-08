# Change Stack

**English** · [Русский](README.ru.md)

`cstack` is a local review tool for pull requests. It opens a change in your browser, splits it into logical layers in reading order, and explains each one with your own OpenAI-compatible model. Code, analysis, and review state stay in memory on your machine and are discarded when the process exits.

## Features

- **Layers** – the model groups changed lines into logical steps, ordered so foundations come first. A file can span several layers.
- **Groups and dependencies** – independent areas of work, "builds on" links, and a full-screen layer map (`G`).
- **Part notes** – larger layers are broken into parts, with a one-line note in the code above each part (`N` to hide).
- **Categories** – a short free-form label per layer, such as "Backend fix" or "UI change".
- **Whole-file panel** – when a layer shows part of a file, open the full diff in a resizable side panel.
- **Reading tools** – split/unified diffs, search (`⌘/Ctrl K`), keyboard navigation, nearby context, symbol lookup, reviewed-file progress, four GitHub/GitLab themes.
- **Original diff and comments** – select a line or range by its line number; after a short pause, open it in GitHub/GitLab or write an inline comment.

## Install

On **macOS on Apple Silicon (arm64)**, copy and paste this command to install the [latest release](https://github.com/Neat-Snap/change-stack/releases/latest). No Bun or Node.js required.

```sh
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/Neat-Snap/change-stack/master/scripts/install.sh | sh' && export PATH="$HOME/.local/bin:$PATH" && cstack --version
```

The installer downloads and verifies the release, installs `cstack` to `~/.local/bin`, and adds that directory to your shell configuration if needed.

The binary is not signed or notarized. If macOS blocks it, allow it in **System Settings → Privacy & Security**.

## Use

```sh
cstack                                  # guided setup, then paste a review link
cstack 'https://gitlab.example/group/project/-/merge_requests/123'
cstack --demo                           # sample review, no network access
cstack --help                           # all options
```

On first run, the CLI asks for a Git token that can read reviews and post comments and your model's base URL, model ID, and API key. Keep the terminal open while reviewing; `Ctrl+C` stops the local server.

Use the same token for reading and commenting:

- **GitLab:** choose the `api` scope. The setup link preselects it. GitLab does not offer a comment-only token scope; `api` grants API access within your account's existing permissions.
- **GitHub:** create a fine-grained token with **Contents: Read-only** and **Pull requests: Read and write**. The setup link preselects these permissions and the repository owner. Select the repositories you review; organization approval may be required. Fork reviews also need read access to the source repository.

If you already saved a read-only token, run `cstack '<review-url>' --setup-git` to replace just the Git token while keeping your model settings. You can also edit an existing GitHub token's permissions on GitHub.

To comment, click a line number or drag across a range, wait for the actions, and choose **Comment**. Write Markdown, then click **Post to GitLab/GitHub** or press **⌘/Ctrl+Enter**. This publishes immediately under your account using your saved token. The link **Posted · view** opens the posted comment. Posting errors preserve your text. Drafts live only in the current page and are not saved after closing it.

Comments work in split/unified views, logical layers, and the whole-file panel. The app checks for new commits or a changed base before posting; reopen the review with `cstack '<review-url>'` if it changed. Comments spanning separate diff hunks or expanded lines outside the original diff are unavailable. Demo mode offers original-diff links without posting.

Settings and credentials live in `~/.change-stack/` (plaintext, mode `0600`). Delete that directory to remove them.

## Development

Requires Bun 1.3.14.

```sh
bun install --frozen-lockfile
bun run demo          # run the UI with sample data
bun run typecheck && bun run test
bun run build         # dist/cstack for this platform
bun run test:tls && bun run test:ui
bun run test:line-actions  # browser checks with local comment stubs
```
