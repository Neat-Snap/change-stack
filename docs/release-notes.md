# Change Stack v0.1.7

Fixes diff selection and comment actions for GitLab and GitHub.

- Preserve line selections and their actions when conversations refresh, including when comments actually change and while a drag is in progress. Keep open comment drafts through these updates.
- Complete selections when a drag ends over an inline thread or outside the diff.
- Allow new selections after jumping from Conversation into the full diff or an individual layer. Navigation highlights do not open comment actions by themselves.
- Keep the Comment button visible for unsupported selections, disabled with an explanation. Inline comments require lines in one hunk of the original provider diff; expanded context outside that diff cannot anchor an inline comment.
- Add browser regression checks for both providers in split and unified layouts, alongside the existing posting, draft, and mobile checks.

Restore CI checks on Ubuntu and macOS, including container checks on Ubuntu. Build the release binary on macOS and publish the GitHub release from Ubuntu. Releases contain only the macOS download and its checksum; container images are not published.

The standalone download is for **macOS Apple Silicon (arm64)** and includes the binary, English/Russian instructions, and license notices. No Bun or Node.js is required. Verify the archive using `SHA256SUMS`. The binary is unsigned and not notarized.
