# Change Stack GitLab addon

An addon to JetBrains' bundled GitLab review integration. Open an MR, then right-click its native changed-files tree and choose **Change Stack → Analyze with Change Stack**. It uses the existing GitLab account, invokes a bundled analyzer, automatically groups the original native files, and adds explanations and line notes to the original diff. Model settings are configured in IDEA; no manual JSON import is required.

Build with JDK 21:

```sh
./gradlew buildPlugin test verifyPluginStructure verifyPluginProjectConfiguration
./gradlew verifyPlugin
```

Output: `build/distributions/change-stack-intellij-0.2.0.zip`. Building also requires Bun to compile the embedded Mac/Linux analyzer executables.

Full laptop installation/testing instructions: [intellij-gitlab-install.md](../docs/intellij-gitlab-install.md).

The grouping and diff UI use platform extension points. `NativeGitLabBridge` isolates version-sensitive internal MR/account interfaces, including the credential representation change across releases. Native file leaves and documents are preserved. Imports/analysis live in memory for the project session; model secrets use Password Safe. Native diffs show whole files, with semantic hints rather than filtered replacement diffs. Supported installation baseline: IDEA 2025.3/build253+.
