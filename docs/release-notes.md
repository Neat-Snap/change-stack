# Change Stack v0.1.4

Change Stack now focuses on the local browser review experience.

- Post inline Markdown comments to GitLab merge requests and GitHub pull requests with the same token used to load the review. Select a line or range, choose **Comment**, then **Post to GitLab/GitHub** or **⌘/Ctrl+Enter**. Posting is immediate under your account.
- Comment from split/unified diffs, logical layers, and the whole-file panel. Posting errors preserve your draft; successful posts link to the original discussion.
- Setup now preselects GitLab’s `api` scope or GitHub’s **Contents: Read-only** and **Pull requests: Read and write**, including the GitHub repository owner.
- Existing users can run `cstack '<review-url>' --setup-git` to upgrade a read-only token without reconfiguring their model. Existing tokens are not automatically upgraded. GitHub organization approval may be required; fork source repositories need read access.
- Before posting, verify that the review’s head and base still match the displayed snapshot. If they changed, reopen the review before sending the comment.
- Improve original-diff links, line-range actions, complete diff recovery, and the commenting keyboard guidance.
- Remove the entire IDE addon, analyzer protocol, JSON export, build scripts, tests, and installation docs. `--ide-request` and `--export-ide` are removed. Existing IDE installations must be uninstalled manually.

Comments must stay within one original diff hunk. Expanded context outside the service’s diff is not commentable. Drafts are held only in the current page. Demo mode never posts comments.

The standalone download is for **macOS Apple Silicon (arm64)** and includes the binary, English/Russian instructions, and license notices. No Bun or Node.js is required. Verify the archive using `SHA256SUMS`. The binary is unsigned and not notarized.

A Linux amd64 container is published as `ghcr.io/neat-snap/change-stack:v0.1.4`. Access follows the package’s visibility settings.
