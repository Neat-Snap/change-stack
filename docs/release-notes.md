# Change Stack v0.1.5

Review conversations now live alongside the code in your browser.

- Show GitLab and GitHub review threads directly in split/unified diffs, logical layers, and the whole-file panel. Open threads expand; resolved threads start collapsed.
- Reply, resolve, and reopen threads using your saved Git token. New inline comments immediately appear as threads. Posting failures preserve your draft.
- Open **Conversation** beside **All changes** for the full discussion, open/resolved filters, general review comments, and new discussions. Long comments and earlier replies expand on demand.
- Above each diff thread in Conversation, show a code excerpt with the commented lines highlighted. Jump to the full diff or a relevant layer; layer links follow the actual code ranges.
- Keep outdated threads in Conversation. Show their historical code context when supplied by GitHub, otherwise link to the original review.
- Refresh conversations every five minutes while the page is visible, when returning to the page, or with the refresh button. Keep reply drafts and previously loaded comments if a refresh fails.
- Print the underlying diagnostic when Git credential verification fails.

Conversation refresh preserves the reviewed diff snapshot. If new commits or a changed base appear, reopen the review to load their diff. Replies and resolution changes are published immediately under your account. GitHub general discussions retain GitHub’s flat PR-comment format. Drafts are held only in the current page.

Token permissions are unchanged from v0.1.4: GitLab’s `api` scope, or GitHub **Contents: Read-only** and **Pull requests: Read and write**. Repository permissions still determine which threads you can resolve or reopen.

The standalone download is for **macOS Apple Silicon (arm64)** and includes the binary, English/Russian instructions, and license notices. No Bun or Node.js is required. Verify the archive using `SHA256SUMS`. The binary is unsigned and not notarized.

A Linux amd64 container is published as `ghcr.io/neat-snap/change-stack:v0.1.5`. Access follows the package’s visibility settings.
