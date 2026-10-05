# Change Stack native GitLab addon validation

Plugin: `dev.changestack.reviews`, version **0.2.2**. Checks run on 2026-10-01 on Linux x86_64 with Temurin JDK 21.0.12.1+1 and Gradle 8.14.3. Compile baseline: IDEA 2025.3 / build 253. Production dependencies remain JetBrains' GitLab and Git integrations; Java is included in the development SDK dependencies for the declaration-navigation test.

## Binary compatibility

JetBrains Plugin Verifier **1.410** checks the final installable ZIP against:

| IDE | Exact build | Verdict |
| --- | --- | --- |
| IDEA unified / Ultimate 2025.3 | IU-253.28294.334 | Compatible |
| IDEA unified / Ultimate 2026.1 | IU-261.22158.277 | Compatible |
| IDEA 2026.1.1, the reported laptop build | IU-261.23567.138 | Compatible |
| IDEA unified / Ultimate 2026.2 | IU-262.8665.258 | Compatible |

All four final plain-text verdicts are Compatible, with no emitted compatibility-problem, internal, experimental, deprecated, or override-only API findings. Reports are under `ide-plugin/build/reports/pluginVerifier/`. The reflected GitLab adapter is version-sensitive; binary verification cannot validate reflected member contracts. The descriptor has no upper build limit; only these four builds are checked here.

## Automated checks

- Gradle plugin build, descriptor structure, and project configuration checks pass.
- **17 JVM tests pass**, including nine tests against IntelliJ's actual platform. They cover native MR action registration and adapter contracts, nested group/layer helper nodes retaining original native file leaves, isolation from another MR's identical path/head objects, sparse hover-only notes without text attributes/stripe/click actions, note cleanup, inline group/layer/file summaries and repeated memberships, restoring pre-analysis grouping across repeated analysis, and MR-only inline controls with progress/cancellation and removal when returning to the list. The header test uses production component data-context lookup, not the headless test manager's default empty context. Parser and corporate CA selection regressions also pass.
- The Java navigation test creates a native `SimpleDiffViewer` with Java diff content and its highlight-file context. It invokes IntelliJ's **actual `GotoDeclarationAction.findTargetElement`** on a method call and resolves the unchanged method before analysis, after a hover note is installed on that call's line, and after reset. It asserts that content, document, highlight file, and declaration target identities are retained. The diff is already open when analysis is applied.
- **82 Bun tests pass**, including metadata export with stable part identities and the IDE stdin/stdout protocol. Protocol tests exercise a GitLab/model fixture with ordering, groups, dependencies, parts, source positions, stale-head rejection before model contact, and credential-safe output.
- All four protocol tests also pass through the **compiled Linux analyzer**. A locally generated private CA enables complete GitLab/model TLS analysis with the selected bundle; an untrusted connection is rejected even with a bypass environment variable set.
- `bun run typecheck` passes.
- The ZIP contains Mach-O arm64 and x86_64 Mac analyzers and a native Linux x64 analyzer. Executables remain outside `lib/` and the Java classpath. Package checksums cover the ZIP, installation guide, validation record, and notices.

## Native UI adapter contracts

SDK bytecode is inspected for **2025.3, 2026.1, 2026.1.1, and 2026.2**. All four details factories use a local MR details provider, a vertical MigLayout, a title component, and a native changed-files component. The addon identifies that local provider through its existing Swing property and reads data through IntelliJ's standard component data context. It inserts a panel below the title without wrapping/reparenting the tool-window content, native tree, or editors. It observes native component additions/removals and showing changes; it does not poll for MRs.

The SDKs expose the expected MR details data key/URL getter, accounts state and suspending credentials lookup, server/name getters, and native comparison-change key/path/revision accessors. Credentials are String on 2025.3/2026.1/2026.1.1 and `GitLabCredentials.getAccessToken()` on 2026.2. Both representations are supported. The native tool-window ID is `Merge Requests` on the baseline, exact laptop SDK, and 2026.2.

Contract inspection establishes member availability, not live authenticated behavior on each IDE.

## Responsiveness and behavior

- The Java plugin JAR is approximately 100 KB; the three compiled analyzers are ordinary payload files under `analyzers/`. Analyzer extraction, certificate lookup, model requests, and Password Safe reads occur only in background analysis.
- The header appears only inside loaded native MR details. Its timer and indeterminate animation run only during that MR's analysis. Progress does not rerender semantic summaries or diff notes.
- Explanations stay in an inline, scrollable panel. Analysis completion and diff notes do not open explanation dialogs.
- Each semantic part gets one hover marker per file, preferring current-side lines and falling back to old-side lines for deletion-only parts. Legacy snapshots are deduplicated by title/summary. Work is capped at 100 markers per viewer. No semantic underline, error-stripe mark, document replacement, editor click handler, or navigation action is installed.
- Native MR diffs register a lightweight listener even before analysis, so an already-open diff receives notes on completion. Other diff requests return without allocating semantic UI/highlighters.
- Reset cancels/invalidate pending work, removes notes and summaries, and restores the native tree's pre-analysis grouping. Results remain scoped to original native MR change objects.

## Practical limits and Mac check

This is a Linux build and headless platform-test environment. The user reported successful model access and analysis with 0.2.1 on macOS 26 / IU-261.23567.138. The new 0.2.2 graphical layout, hover interaction, and live authenticated GitLab workflow have not been exercised on that laptop here.

The specific Mac MR declaration-navigation failure has **not been reproduced or conclusively diagnosed**. The regression test demonstrates retained declaration resolution in the native Java diff fixture, including a semantic marker, but is not proof that every remote GitLab diff resolves against a particular checkout. The visible Reset review control permits a direct comparison in the same MR without uninstalling. See the installation guide for that check.

Group explanations display their constituent layer summaries. Native file leaves occur once under the first ordered layer, while inline file summaries list all memberships. Whole-file diffs, native commenting, and native line mappings remain intact; hunk filtering is not implemented. Analysis lives in memory for the project session.
