# Change Stack GitLab addon — 0.2.2

This addon extends **JetBrains' bundled GitLab merge-request integration** (`org.jetbrains.plugins.gitlab`). It analyzes the open MR with the existing GitLab account, groups native changed-file leaves, and adds inline explanations and hover notes. GitLab owns authentication, original diffs, comments, review submission, and merge controls.

The ZIP includes the analyzer for Apple Silicon, Intel Macs, and Linux x64. No separate CLI setup or JSON export/import is needed. Model access, progress, cancellation, and corporate CA support from 0.2.1 are retained.

## Install the update

1. Download **`change-stack-intellij-0.2.2.zip`** and keep it intact.
2. On macOS, open **IntelliJ IDEA → Settings… → Plugins → gear menu → Install Plugin from Disk…**.
3. Select the ZIP and **restart IDEA**. It updates the existing Change Stack installation; confirm **0.2.2** under Plugins → Installed. Saved model settings remain available.
4. Keep the bundled **GitLab** and **Git** plugins enabled.
5. Open the MR's local Git repository as your IDEA project, then open the MR through GitLab's **Merge Requests** tool window.

The minimum build is 253 (IDEA 2025.3). The unified IDEA distribution supports the addon in free and paid modes when the bundled GitLab integration is available. The exact reported **2026.1.1 / IU-261.23567.138** is included in compatibility checks. See `VALIDATION.md` for checked versions and remaining manual checks.

## Analyze and review

1. Wait for GitLab's changed files to load and select **All commits / the whole MR**.
2. Click **Analyze MR** immediately below the native MR heading. These controls appear inside loaded MR details, not on the MR list. The native changed-file context menu also provides **Change Stack → Analyze with Change Stack**.
3. On first use, configure the OpenAI-compatible API base URL, model ID, API key, and explanation language. Include `/v1` if your endpoint requires it. The model receives MR changes and bounded repository context. The key is stored through IDEA's Password Safe.
4. The header shows the current stage, batch/part counters, elapsed time, and an indeterminate progress bar. **Cancel** stops the background task and analyzer process. Continue using IDEA while it runs.
5. When analysis completes, the native tree rebuilds as **group → ordered layers → original GitLab file leaves**. No explanation window opens.
6. Select a **group** to read the summaries of its contained layers below the MR heading. Select a **layer** for its explanation, parts, and dependencies. Select a **file** to see all its layer memberships and explanations in the same inline panel. The panel scrolls so longer explanations do not consume the file tree.
7. Open files through the native tree and use GitLab's normal diff and comments. **Hover** over an information icon for a small explanation tooltip. Each semantic part gets one marker per file, preferring the current side; a deleted-only part uses the old side. Split and unified diffs use native line mappings. There are no semantic blue underlines, error-stripe marks, click actions, or separate note dialogs. Already-open native diffs receive notes when analysis completes.

A file occurs once under its first ordered layer; the inline summary lists its other memberships. Native whole-file diffs remain whole: the addon does not filter hunks or replace diff content. Group explanations display the constituent layer summaries; no separate model-generated group synopsis is invented.

## Settings and corporate certificates

Click the **gear icon** beside Analyze MR, or **Change Stack → Analysis settings…** in a native MR menu.

- Leave **Use Nessy certificate automatically when present** enabled to read `~/.nessy/certs/tinkoff-bundle.crt` directly on each analysis run. No copy or terminal launch is needed.
- For another certificate, use **Browse…** to select a readable PEM bundle (`.crt` or `.pem`), or enter an absolute path / `~/…` path.
- An explicit path takes precedence over `CHANGE_STACK_CA_FILE`. If the field is blank, that environment variable takes precedence over automatic Nessy detection. The checkbox only controls Nessy detection.
- Invalid or missing explicit bundles produce an error instead of silently substituting a different bundle. Changes apply on the next analysis without restarting.

The selected CA extends normal trusted roots for both analyzer GitLab and model HTTPS requests; TLS verification stays enabled. IDEA's native GitLab/JVM trust configuration is independent. No certificate is read at IDE startup.

If the model is unavailable, the status says **Model unavailable · local grouping only**. The inline summary includes the analysis warnings. Correct the endpoint/model/key/certificate with the gear icon and analyze again.

## Reset, reanalyze, and return to the MR list

- Click the visible **Reset review** button beneath the inline summary to remove semantic analysis and notes, and restore the tree's grouping from before the first analysis. Reanalysis preserves that original grouping snapshot. Reset also prevents a pending analysis result from being applied. The MR stays open, with its native GitLab functionality available.
- The native MR context menu also has **Change Stack → Clear semantic review**.
- To return to the MR list, use GitLab's native back/list navigation. Closing a diff editor tab does not clear the analysis or close the MR details in the tool window.
- Run **Analyze MR** again after GitLab refreshes the MR. Results are checked against the native loaded head and original change objects; a stale result is discarded. Another MR's equal path/head objects do not receive these groups or notes.
- Results last for the project session. Restarting IDEA clears the analysis; saved settings remain.

## Check declaration navigation

In a native MR diff, try **⌘-click** (or **Navigate → Declaration or Usages**) on a Java method reference before analysis and again with semantic notes present. The addon retains GitLab's diff request, documents, highlight-file association, and editor actions. A platform regression test verifies Java declaration resolution with a hover note on the method-call line, including an already-open diff and reset.

The specific navigation failure reported on your Mac has not been reproduced here. If it remains, click **Reset review** and repeat the same reference in the same diff. Report whether reset changes the result, whether the equivalent local source reference resolves, and whether your checkout matches the MR branch. This distinguishes addon behavior from the native remote-diff context without requiring an uninstall.

## Transfer to your working laptop

Copy the same **0.2.2 ZIP** and these instructions. Install from disk and restart. Use that laptop's existing native GitLab account and configure its model key. The ZIP chooses the appropriate Mac architecture automatically; personal credentials are not packaged.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| No analysis controls | Confirm 0.2.2 is enabled, restart, open an MR's details, and wait for the native changed-files tree. Controls intentionally do not appear on the MR list. |
| Cannot verify MR head | Select the whole MR/all commits, refresh the native review, and retry. |
| GitLab login needed | Sign in through Settings → Version Control → GitLab. |
| Model unavailable / certificate error | Read the inline analysis warnings and use the gear icon to correct settings or select the PEM bundle. |
| Missing hover notes | Notes require source-line ranges and matching native change objects. Hover the information icon; text/binary files without source ranges have no markers. |
| Declaration navigation fails | Use Reset review and compare the same native diff reference; see the navigation check above. |
| Internal adapter error | Include the exact IDEA build, plugin version, displayed error, and relevant `idea.log` excerpt. |

Find logs with **Help → Show Log in Finder**. For a freeze, capture a thread dump through **Help → Diagnostic Tools → Thread Dump** or an automatic `threadDumps-freeze-*` directory under `~/Library/Logs/JetBrains/IntelliJIdea2026.1/`. If IDEA cannot start, quit it and temporarily add `dev.changestack.reviews` on its own line in `~/Library/Application Support/JetBrains/IntelliJIdea2026.1/disabled_plugins.txt`, preserving other entries. Do not include API keys or access tokens in reports.

## Build from source

Requires Bun and JDK 21:

```sh
cd ide-plugin
./gradlew test buildPlugin verifyPluginStructure verifyPluginProjectConfiguration
./gradlew verifyPlugin
cd ..
bun run build:ide-preview
```

The Gradle build compiles all analyzer binaries automatically. The installable file is `ide-plugin/build/distributions/change-stack-intellij-0.2.2.zip`. Packaging copies it with this guide, validation details, notices, and checksums into `dist/ide-preview-v0.2.2/`. Nothing is published automatically.
