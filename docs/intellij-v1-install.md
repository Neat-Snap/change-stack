# Change Stack for IntelliJ IDEA — V1 installation and testing

This preview adds **Semantic Layers** to IntelliJ's changes-tree **Group By** menu and a **Change Stack** explanation tool window. It uses the public platform VCS APIs, so you can keep reviewing the original files through the bundled GitLab integration.

V1 imports an analysis produced by `cstack`. It does not ask for your GitLab token, read IntelliJ's saved token, or send comments. A native file appears once, under its first semantic layer; the explanation panel shows every membership, group, dependency, and part. Native diffs still show the whole file's changes.

## Files to download

The complete test package is `change-stack-ide-preview-v0.1.0.tar.gz`. Extract it in Finder or Terminal. The extracted `ide-preview-v0.1.0` folder contains:

- `change-stack-intellij-0.1.0.zip` — the installable plugin. **Keep this ZIP intact.**
- `macos-arm64/cstack` — the preview analyzer for Apple Silicon.
- `macos-x64/cstack` — the preview analyzer for Intel Macs.
- `demo/` — a small Java repository generator for testing without GitLab or a model.
- `sample-analysis.json`, `SHA256SUMS`, `VALIDATION.md`, and these instructions.

If you only want to check installation and the explanation panel, the plugin ZIP is sufficient. No Bun, Gradle, Java installation, or Marketplace account is needed to install it: it runs in IntelliJ's own runtime.

## 1. Check your IDEA version

On macOS, choose **IntelliJ IDEA → About IntelliJ IDEA** or **Help → About**, depending on the version. Note the version and build number.

The plugin requires **2025.1 / build 251 or later**. Community and Ultimate use the same platform VCS APIs. Starting with 2025.3, IDEA uses the unified distribution. The plugin ZIP is the same for Apple Silicon and Intel Macs.

See the validation record at the end for the exact versions checked. An unlisted build is not a promise of compatibility. If your IDE rejects the ZIP, copy the exact build number and the error; do not edit the ZIP's compatibility metadata.

## 2. Install the plugin from disk

1. Open IntelliJ IDEA on your personal laptop.
2. Choose **IntelliJ IDEA → Settings…** (`⌘,`).
3. Open **Plugins**.
4. Click the **gear / settings menu** in the Plugins page.
5. Choose **Install Plugin from Disk…**.
6. Select **`change-stack-intellij-0.1.0.zip`** from the extracted package. Do not select the outer `.tar.gz`, a directory, or an extracted JAR.
7. Accept IntelliJ's local-plugin installation prompt and restart the IDE if requested.
8. Open a project, then choose **Tools → Change Stack**. Alternatively use **View → Tool Windows → Change Stack**, or **Find Action** (`⌘⇧A`) and search for **Change Stack**.

You should see **Import analysis…**, **Load sample**, **Clear**, and a **Repository root** field. If you cannot see the tool window, check that Change Stack is enabled in **Settings → Plugins → Installed**, and restart with a project open.

## 3. First test: no accounts or network requests

Click **Load sample**. The explanation tree should show:

- **Invitation validation** with two layers;
- **Regression coverage** with a test layer;
- `InvitationService.java` in both of its layer memberships;
- a review overview identifying the content as a sample.

Select a layer to read its explanation, dependencies, and parts. This checks that the plugin and its panel load. To test native grouping as well, create the matching Java demo repository:

```sh
cd "$HOME/Downloads/ide-preview-v0.1.0"
sh demo/setup-demo.sh "$HOME/Downloads/change-stack-idea-demo"
```

Adjust the first path to wherever you extracted the package. The script requires Git and creates a **new** repository with three modified Java files. It refuses to overwrite an existing directory. If Git is missing, macOS may offer to install its Command Line Tools.

1. In IntelliJ, choose **File → Open…**, select `change-stack-idea-demo`, and open it as a project.
2. Open **Tools → Change Stack**.
3. Set **Repository root** to `change-stack-idea-demo`, then click **Load sample** again.
4. Open IntelliJ's **Commit** tool window (`⌘K` opens the commit workflow on the default macOS keymap). If it shows no Git changes, use **VCS → Enable Version Control Integration… → Git**.
5. In the changed-files tree, find **Group By** in its toolbar/menu or right-click menu. Enable **Semantic Layers**. Disable **Directory** grouping if you want the semantic groups to be easier to see.
6. The three modified files should appear under numbered semantic layer groups. `InvitationService.java` should appear once under the first layer in this native tree.
7. Double-click a file in the **native changes tree**: IntelliJ should open its normal diff. Double-clicking a file in the **Change Stack explanation panel** opens your local editor instead.

You do not need to build or run the Java demo to inspect its diffs. There is no GitLab remote, and native GitLab comments are not available in this local-only test.

## 4. Prepare the preview analyzer on your Mac

In **Apple menu → About This Mac**, “Chip: Apple M…” means use `macos-arm64`; “Processor: Intel…” means use `macos-x64`. You can also run `uname -m` in Terminal: normally `arm64` or `x86_64`.

For Apple Silicon:

```sh
cd "$HOME/Downloads/ide-preview-v0.1.0"
chmod +x macos-arm64/cstack
./macos-arm64/cstack --version
./macos-arm64/cstack --help
```

For Intel, replace `macos-arm64` with `macos-x64`. The version should be **`0.1.4-ide-preview.1`**, and help should include **`--export-ide PATH`**. Use this preview binary rather than an older installed `cstack` release.

These locally built analyzer binaries are not signed or notarized. If macOS blocks the executable, use **System Settings → Privacy & Security** to allow this downloaded preview and retry. Plugin installation itself does not need a separate executable permission.

Optional: verify package contents before running them:

```sh
shasum -a 256 -c SHA256SUMS
```

## 5. Test a real GitLab merge request

First open the correct local repository in IntelliJ. Keep using JetBrains' bundled GitLab integration to log in and open the MR. Its account is separate from `cstack` configuration; this plugin does not read that token.

Export the analysis using the preview binary:

```sh
cd "$HOME/Downloads/ide-preview-v0.1.0"
./macos-arm64/cstack 'https://gitlab.example/group/project/-/merge_requests/123' \
  --export-ide "$HOME/Downloads/review-123.change-stack.json"
```

Replace the URL with your MR URL and use `macos-x64` on Intel. First-run setup happens in this terminal: `cstack` asks for its GitLab token and optionally your OpenAI-compatible model endpoint/model/API key. For fetching and analyzing, the existing **`read_api`** token scope is sufficient. Save model settings when prompted to get semantic explanations. If you decline model setup, the export uses the existing local fallback groups; that tests the import path but not model-generated semantics.

The command fetches the MR, prepares its analysis, writes the JSON, and exits. It does not start the browser server. The exported file includes file names, review identity, and explanations; it excludes patches, source contents, Git/AI credentials, and browser-session secrets.

Back in IntelliJ:

1. Open **Tools → Change Stack**.
2. Check **Repository root**: it must be the root of this MR's repository, where `.git` lives. For a project containing several repositories, use **Choose…** to select the correct one.
3. Click **Import analysis…** and select `review-123.change-stack.json`.
4. Select **Review overview**. Confirm that its **URL and full head SHA** match the MR version currently open in IntelliJ.
5. In the native GitLab MR changed-files tree, enable **Group By → Semantic Layers**. The shared Group By menu may be in the tree's toolbar/options menu or right-click menu, depending on IDEA version.
6. If Semantic Layers was already on, turn it **off, then on** to rebuild the tree with the new import.
7. Select files and review/comment through the **native GitLab diff**. The addon only changes their grouping and shows explanations.
8. Read the full group/layer/part structure in the Change Stack panel. A file that participates in several layers appears in each of those panel entries, while its native file leaf appears once.

Native GitLab authentication and commenting use IntelliJ's existing account permissions. Configure that account under **Settings → Version Control → GitLab**; follow IntelliJ's token-creation instructions. The addon does not grant commenting rights.

## 6. Updates, clearing, and another laptop

- **New commits / another MR:** export again and import the matching analysis. V1 does not automatically detect that an MR changed. Confirm the displayed URL/SHA every time, then toggle Semantic Layers off/on.
- **Clear:** click Clear in the panel, then toggle Semantic Layers off/on in the native tree to remove cached groups. Files remain available in their usual tree.
- **Restart:** imports live in memory for this project session. Import the analysis again after restarting the IDE; there is no hidden saved analysis or credential store in the addon.
- **Update the addon:** use Install Plugin from Disk again with the new plugin ZIP, and restart if requested.
- **Work laptop:** transfer the same plugin ZIP and these instructions, install from disk there, and generate/import an analysis matching that laptop's repository/MR. The plugin ZIP works on both Mac architectures. If you need the analyzer there too, transfer the matching `macos-*` executable and configure that laptop's own credentials.
- **Uninstall:** Settings → Plugins → Installed → Change Stack → Uninstall, then restart if requested. This does not change your repository or remove IntelliJ's GitLab account.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Plugin incompatible | Copy the exact IDEA build from About. The minimum build is 251. |
| No Semantic Layers menu item | Ensure the addon is enabled, open a project, and use a changed-files tree with IntelliJ's standard Group By menu. The Project file tree is different. |
| Imported layers visible, native files not grouped | Verify repository root and the imported paths; then toggle Semantic Layers off/on. Exact repository paths are used, so another repository's same-named files are not matched. |
| Grouping remains after Clear | Toggle Semantic Layers off/on to rebuild the existing native tree. |
| A file appears in multiple explanation layers | Expected: one file can have several purposes. The native tree assigns it to its first layer only. |
| No comment box | Open the file in the native GitLab MR diff, not the local Commit diff or the explanation-panel editor. Check native GitLab account permissions. |
| `--export-ide` unknown | You are running an older `cstack`; use the included preview binary. |
| Model unavailable | The export may use local fallback groups and include a warning. Inspect Review overview or configure the model with `cstack --setup-ai`. |

If the addon throws an error, use **Help → Show Log in Finder** to locate `idea.log`. Share the exact IDE build, plugin version, action that failed, and the related exception. You do not need to send your token or model API key.

## Validation record

The addon is built against IDEA Community 2025.1 with Java 21. Automated tests exercise the actual IntelliJ tree builder and Swing panel, repeated memberships, exact repository matching, clear/rebuild behavior, and import validation. See `VALIDATION.md` in the preview package (or `ide-plugin/VALIDATION.md` in the source repository) for binary compatibility results from Plugin Verifier.

The build host is Linux. The Mac analyzer executables are cross-compiled; their native execution on macOS and live GitLab review/comment interaction are the laptop tests above. Automated compatibility checks do not replace that manual test.

## Building from source (optional)

Only development needs JDK 21 and Bun. From the repository:

```sh
cd ide-plugin
./gradlew buildPlugin test verifyPluginStructure verifyPluginProjectConfiguration
./gradlew verifyPlugin
cd ..
bun run build:ide-preview
```

`build:ide-preview` expects the plugin ZIP from the Gradle build. The wrapper pins Gradle and verifies its distribution checksum. It packages the plugin, both macOS analyzer binaries, demo files, notices, and instructions into the preview archive without publishing anything.
