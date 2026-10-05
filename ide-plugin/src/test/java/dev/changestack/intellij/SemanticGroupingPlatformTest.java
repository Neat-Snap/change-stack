package dev.changestack.intellij;

import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vcs.changes.ui.ChangesBrowserNode;
import com.intellij.openapi.vcs.changes.ui.TreeModelBuilder;
import com.intellij.testFramework.LightPlatformTestCase;
import com.intellij.vcsUtil.VcsUtil;
import com.intellij.openapi.actionSystem.ActionManager;

import javax.swing.tree.DefaultTreeModel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.awt.Component;
import java.awt.Container;
import javax.swing.JButton;
import javax.swing.JTree;
import javax.swing.tree.DefaultMutableTreeNode;
import com.intellij.testFramework.EdtTestUtil;

/** Exercises IntelliJ's actual model builder, rather than a simulated grouping API. */
public class SemanticGroupingPlatformTest extends LightPlatformTestCase {
    public void testHeaderPreservesNativeContentAndShowsProgressAndCancellation() throws Exception {
        com.intellij.ide.impl.HeadlessDataManager.fallbackToProductionDataManager(getTestRootDisposable());
        EdtTestUtil.runInEdtAndWait(() -> {
            var factory = com.intellij.ui.content.ContentFactory.getInstance();
            var manager = factory.createContentManager(true, getProject());
            var original = new javax.swing.JPanel();
            original.add(new javax.swing.JLabel("Native GitLab MR list"));
            var details = new javax.swing.JPanel(new net.miginfocom.swing.MigLayout("flowy, nogrid, fill, hidemode 3"));
            var title = new javax.swing.JLabel("Native MR heading"); details.add(title, "growx");
            var nativeTree = new com.intellij.openapi.vcs.changes.ui.ChangesTree(getProject(), false, false) { @Override public void rebuildTree() {} };
            details.add(nativeTree, "grow");
            String url = "https://gitlab.example/team/repo/-/merge_requests/7";
            Object vm = java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                    new Class<?>[]{org.jetbrains.plugins.gitlab.mergerequest.ui.details.model.GitLabMergeRequestDetailsViewModel.class},
                    (proxy, method, arguments) -> method.getName().equals("getUrl") ? url : null);
            com.intellij.ide.DataManager.registerDataProvider(details, key -> key.equals(NativeGitLabBridge.DETAILS_KEY) ? vm : key.equals(com.intellij.openapi.actionSystem.CommonDataKeys.PROJECT.getName()) ? getProject() : null);
            var content = factory.createContent(original, "GitLab MR", false); manager.addContent(content);
            var window = (com.intellij.openapi.wm.ToolWindow) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                    new Class<?>[]{com.intellij.openapi.wm.ToolWindow.class}, (proxy, method, arguments) -> switch (method.getName()) {
                        case "getContentManager" -> manager;
                        case "getProject" -> getProject();
                        case "getId" -> "Merge Requests";
                        case "isDisposed" -> false;
                        default -> null;
                    });
            var header = new GitLabReviewHeader(getProject());
            var service = getProject().getService(SemanticSnapshotService.class);
            try {
                header.attach(window); header.attach(window);
                assertSame(original, content.getComponent());
                assertNull("No analysis controls on the MR list", find(original, JButton.class, "Analyze MR"));
                original.add(details); com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents();
                assertSame("Preserve native content identity", original, content.getComponent());
                assertSame("Preserve the native heading", title, details.getComponent(0));
                var nativeContext = com.intellij.ide.DataManager.getInstance().getDataContext(details);
                assertEquals("Native MR context must resolve: " + nativeContext.getClass().getName(), url, NativeGitLabBridge.reviewUrl(nativeContext));
                assertEquals("ChangeStack.GitLab.AnalysisHeader", details.getComponent(1).getName());
                assertSame("Preserve native tree and its data-provider ancestry", details, nativeTree.getParent());
                JButton analyze = find(content.getComponent(), JButton.class, "Analyze MR");
                JButton cancel = find(content.getComponent(), JButton.class, "Cancel");
                assertNotNull(analyze); assertNotNull(cancel); assertTrue(analyze.isEnabled()); assertFalse(cancel.isVisible());
                assertTrue(service.beginAnalysis("https://gitlab.example/team/repo/-/merge_requests/7"));
                service.reportProgress("Step 1/3 · Preparing review layers: batch 2/4");
                com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents();
                assertFalse(analyze.isEnabled()); assertTrue(cancel.isVisible());
                var bar = find(content.getComponent(), javax.swing.JProgressBar.class, null);
                assertNotNull(bar); assertTrue(bar.isVisible()); assertTrue(bar.isIndeterminate());
                var label = find(content.getComponent(), com.intellij.ui.components.JBLabel.class, null);
                assertNotNull(label); assertTrue(label.getText().contains("batch 2/4"));
                cancel.doClick();
                var indicator = new com.intellij.openapi.progress.util.ProgressIndicatorBase();
                service.bindIndicator(indicator); assertTrue("Early cancellation must reach a task that hasn't started yet", indicator.isCanceled());
                service.finishAnalysis("Analysis cancelled"); com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents();
                assertTrue(analyze.isEnabled()); assertFalse(cancel.isVisible()); assertFalse(bar.isVisible());
                assertEquals("Analysis cancelled", label.getText());
                assertFalse("No idle animation", bar.isIndeterminate());
                original.remove(details); com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents();
                assertNull("Controls disappear when returning to the MR list", find(original, JButton.class, "Analyze MR"));
                assertNull("Remove addon UI from detached details", find(details, JButton.class, "Analyze MR"));
                com.intellij.openapi.util.Disposer.dispose(header);
                assertSame("Unloading restores the original GitLab component", original, content.getComponent());
            } finally {
                service.finishAnalysis("Ready");
                if (!com.intellij.openapi.util.Disposer.isDisposed(header)) com.intellij.openapi.util.Disposer.dispose(header);
                com.intellij.openapi.util.Disposer.dispose(manager);
            }
        });
    }
    public void testGroupsOriginalFileLeavesAndKeepsUnrelatedFiles() throws Exception {
        var action = ActionManager.getInstance().getAction("ChangeStack.SemanticGrouping");
        assertNotNull("The native Group By action must be registered", action);
        assertEquals("dev.changestack.intellij.SemanticGroupingAction", action.getClass().getName());
        ReviewSnapshot snapshot;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) {
            assertNotNull(input); snapshot = ReviewSnapshot.parse(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
        SemanticSnapshotService service = getProject().getService(SemanticSnapshotService.class);
        String base = "/tmp/cstack-tree-test";
        service.install(snapshot, Path.of(base));
        List<FilePath> files = new ArrayList<>(snapshot.files().stream().map(file -> VcsUtil.getFilePath(base + "/" + file.path(), false)).toList());
        FilePath unrelated = VcsUtil.getFilePath("/tmp/other-repository/src/main/java/demo/InvitationService.java", false);
        files.add(unrelated);
        try {
            DefaultTreeModel model = TreeModelBuilder.buildFromFilePaths(getProject(), new SemanticGroupingFactory(), files);
            var nodes = ((ChangesBrowserNode<?>) model.getRoot()).depthFirstEnumeration();
            int count = 0, grouped = 0;
            while (nodes.hasMoreElements()) {
                var node = (ChangesBrowserNode<?>) nodes.nextElement();
                if (!(node.getUserObject() instanceof FilePath file) || file.isDirectory()) continue;
                count++;
                assertTrue("Keep the original native file objects", files.stream().anyMatch(original -> original == file));
                var parent = (ChangesBrowserNode<?>) node.getParent();
                if (file == unrelated) assertFalse(parent.getUserObject() instanceof ReviewSnapshot.LayerKey);
                else {
                    grouped++;
                    var layer = service.getState().pathToLayer().get(file.getPath());
                    assertEquals(layer, parent.getUserObject());
                    var group = snapshot.layerGroups().get(layer.id());
                    if (group != null) assertEquals(group, ((ChangesBrowserNode<?>) parent.getParent()).getUserObject());
                    assertFalse(layer.label().contains(" / "));
                }
            }
            assertEquals(files.size(), count);
            assertEquals(snapshot.files().size(), grouped);
            service.clear();
            var cleared = ((ChangesBrowserNode<?>) TreeModelBuilder.buildFromFilePaths(getProject(), new SemanticGroupingFactory(), files).getRoot()).depthFirstEnumeration();
            while (cleared.hasMoreElements()) assertFalse(((ChangesBrowserNode<?>) cleared.nextElement()).getUserObject() instanceof ReviewSnapshot.LayerKey);
        } finally { service.clear(); }
    }

    public void testRealToolWindowPanelListsAllMembershipsAndClears() throws Exception {
        ReviewSnapshot snapshot;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) {
            assertNotNull(input); snapshot = ReviewSnapshot.parse(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
        SemanticSnapshotService service = getProject().getService(SemanticSnapshotService.class);
        service.install(snapshot, Path.of("/tmp/cstack-panel-test"));
        try {
            EdtTestUtil.runInEdtAndWait(() -> {
                ChangeStackPanel panel = new ChangeStackPanel(getProject());
                JTree tree = find(panel, JTree.class, null);
                assertNotNull(tree);
                var nodes = ((DefaultMutableTreeNode) tree.getModel().getRoot()).depthFirstEnumeration();
                int serviceMemberships = 0;
                while (nodes.hasMoreElements()) if (nodes.nextElement().toString().equals("src/main/java/demo/InvitationService.java")) serviceMemberships++;
                assertEquals("Repeated memberships stay in the explanation panel", 2, serviceMemberships);
                JButton clear = find(panel, JButton.class, "Clear");
                assertNotNull(clear); clear.doClick();
                assertNull(service.getState());
                assertEquals(0, ((DefaultMutableTreeNode) tree.getModel().getRoot()).getChildCount());
            });
        } finally { service.clear(); }
    }

    public void testNativeGitLabActionRegistrationAndInternalAdapterContract() throws Exception {
        var action = ActionManager.getInstance().getAction("ChangeStack.AnalyzeGitLab");
        assertNotNull(action); assertEquals(AnalyzeGitLabAction.class, action.getClass());
        var group = (com.intellij.openapi.actionSystem.ActionGroup) ActionManager.getInstance().getAction("GitLab.Merge.Request.Changes.Popup");
        assertNotNull(group);
        assertTrue(java.util.Arrays.stream(group.getChildren(null)).anyMatch(child -> "ChangeStack.GitLab".equals(ActionManager.getInstance().getId(child))));
        Class<?> vm = Class.forName("org.jetbrains.plugins.gitlab.mergerequest.ui.details.GitLabMergeRequestViewModel");
        Object companion = vm.getField("Companion").get(null);
        var key = (com.intellij.openapi.actionSystem.DataKey<?>) NativeGitLabBridge.invoke(companion, "getDATA_KEY");
        assertEquals(NativeGitLabBridge.DETAILS_KEY, key.getName());
        assertEquals(String.class, vm.getMethod("getUrl").getReturnType());
        Class<?> manager = Class.forName("org.jetbrains.plugins.gitlab.authentication.accounts.GitLabAccountManager");
        assertNotNull(manager.getMethod("getAccountsState"));
        assertTrue(java.util.Arrays.stream(manager.getMethods()).anyMatch(method -> method.getName().equals("findCredentials") && method.getParameterCount() == 2));
    }

    public void testNativeGroupingIsScopedToOriginalMrObjectsEvenForTheSamePathAndHead() throws Exception {
        ReviewSnapshot snapshot;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) { snapshot = ReviewSnapshot.parse(new String(input.readAllBytes(), StandardCharsets.UTF_8)); }
        String base = "/tmp/native-gitlab-scope";
        FilePath path = VcsUtil.getFilePath(base + "/" + snapshot.files().getFirst().path(), false);
        var head = new git4idea.GitRevisionNumber("a".repeat(40));
        var before = new git4idea.GitRevisionNumber("b".repeat(40));
        var selected = new com.intellij.collaboration.util.RefComparisonChange(before, path, head, path);
        var other = new com.intellij.collaboration.util.RefComparisonChange(before, path, head, path);
        java.util.Set<Object> members = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>()); members.add(selected);
        SemanticSnapshotService service = getProject().getService(SemanticSnapshotService.class);
        service.installNative(snapshot, new NativeGitLabBridge.Context(snapshot.url(), null, Path.of(base), members, head.asString()));
        try {
            assertTrue(service.accepts(selected)); assertFalse(service.accepts(other));
            assertEquals(path.getPath(), NativeGitLabBridge.changePath(selected));
            assertEquals(head.asString(), NativeGitLabBridge.revisionAfter(selected));
            var builder = new TreeModelBuilder(getProject(), new SemanticGroupingFactory());
            var root = (ChangesBrowserNode<?>) builder.build().getRoot();
            ChangesBrowserNode<Object> originalLeaf = new ChangesBrowserNode<>(selected) {};
            ChangesBrowserNode<Object> otherLeaf = new ChangesBrowserNode<>(other) {};
            builder.insertChangeNode(path, root, originalLeaf); builder.insertChangeNode(path, root, otherLeaf);
            builder.build();
            assertSame(selected, originalLeaf.getUserObject());
            assertTrue(((ChangesBrowserNode<?>) originalLeaf.getParent()).getUserObject() instanceof ReviewSnapshot.LayerKey);
            assertFalse(((ChangesBrowserNode<?>) otherLeaf.getParent()).getUserObject() instanceof ReviewSnapshot.LayerKey);
            var request = new com.intellij.diff.requests.SimpleDiffRequest("Native MR", com.intellij.diff.DiffContentFactory.getInstance().create("before"),
                    com.intellij.diff.DiffContentFactory.getInstance().create("after"), "before", "after");
            Object companion = selected.getClass().getField("Companion").get(null);
            @SuppressWarnings("unchecked") var key = (com.intellij.openapi.util.Key<Object>) NativeGitLabBridge.invoke(companion, "getKEY");
            request.putUserData(key, selected);
            assertSame(selected, NativeGitLabBridge.diffChange(request));
            service.clear(); assertFalse(service.isNative());
        } finally { service.clear(); }
    }

    public void testSemanticNotesUseOriginalNativeDiffDocumentsAndClearWithoutChangingSource() throws Exception {
        String text;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) { text = new String(input.readAllBytes(), StandardCharsets.UTF_8); }
        var json = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
        var annotations = com.google.gson.JsonParser.parseString("[{\"path\":\"src/main/java/demo/InvitationService.java\",\"side\":\"current\",\"start\":2,\"end\":8,\"title\":\"Validate invitation\",\"summary\":\"Rejects invalid invitations.\"}]");
        annotations.getAsJsonArray().add(annotations.getAsJsonArray().get(0).deepCopy());
        json.getAsJsonObject("analysis").getAsJsonArray("layers").get(0).getAsJsonObject().add("annotations", annotations);
        ReviewSnapshot snapshot = ReviewSnapshot.parse(json.toString());
        String base = "/tmp/native-diff-test";
        FilePath file = VcsUtil.getFilePath(base + "/src/main/java/demo/InvitationService.java", false);
        var change = new com.intellij.collaboration.util.RefComparisonChange(new git4idea.GitRevisionNumber("b".repeat(40)), file, new git4idea.GitRevisionNumber("a".repeat(40)), file);
        var service = getProject().getService(SemanticSnapshotService.class);
        java.util.Set<Object> changes = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>()); changes.add(change);
        service.installNative(snapshot, new NativeGitLabBridge.Context(snapshot.url(), null, Path.of(base), changes, "a".repeat(40)));
        try {
            EdtTestUtil.runInEdtAndWait(() -> {
                var request = new com.intellij.diff.requests.SimpleDiffRequest("GitLab MR", com.intellij.diff.DiffContentFactory.getInstance().create("before\n"),
                        com.intellij.diff.DiffContentFactory.getInstance().create("first\nsecond\n"), "base", "head");
                try {
                    Object companion = change.getClass().getField("Companion").get(null);
                    @SuppressWarnings("unchecked") var key = (com.intellij.openapi.util.Key<Object>) NativeGitLabBridge.invoke(companion, "getKEY");
                    request.putUserData(key, change);
                } catch (ReflectiveOperationException error) { throw new RuntimeException(error); }
                var holder = new com.intellij.openapi.util.UserDataHolderBase();
                var context = new com.intellij.diff.DiffContext() {
                    @Override public com.intellij.openapi.project.Project getProject() { return SemanticGroupingPlatformTest.this.getProject(); }
                    @Override public boolean isWindowFocused() { return false; }
                    @Override public boolean isFocusedInWindow() { return false; }
                    @Override public void requestFocusInWindow() { }
                    @Override public <T> T getUserData(com.intellij.openapi.util.Key<T> key) { return holder.getUserData(key); }
                    @Override public <T> void putUserData(com.intellij.openapi.util.Key<T> key, T value) { holder.putUserData(key, value); }
                };
                var viewer = new com.intellij.diff.tools.simple.SimpleDiffViewer(context, request);
                try {
                    int before = viewer.getEditor2().getMarkupModel().getAllHighlighters().length;
                    new SemanticDiffExtension().onViewerCreated(viewer, context, request);
                    viewer.init();
                    assertTrue(viewer.getEditor2().getMarkupModel().getAllHighlighters().length > before);
                    assertEquals("first\nsecond\n", viewer.getEditor2().getDocument().getText());
                    assertNull(find(viewer.getComponent(), JButton.class, "Semantic explanation…"));
                    var notes = java.util.Arrays.stream(viewer.getEditor2().getMarkupModel().getAllHighlighters()).filter(item -> item.getGutterIconRenderer() != null).toList();
                    assertEquals("One marker per semantic part", 1, notes.size());
                    var note = notes.getFirst();
                    assertNull("No blue underline", note.getTextAttributes());
                    assertNull("No stripe marker", note.getErrorStripeMarkColor(viewer.getEditor2().getColorsScheme()));
                    assertFalse(note.getGutterIconRenderer().isNavigateAction());
                    assertNull("Hover note never hijacks a navigation click", note.getGutterIconRenderer().getClickAction());
                    assertTrue(note.getGutterIconRenderer().getTooltipText().contains("Rejects invalid invitations"));
                    service.clear();
                    assertEquals("first\nsecond\n", viewer.getEditor2().getDocument().getText());
                    assertTrue(java.util.Arrays.stream(viewer.getEditor2().getMarkupModel().getAllHighlighters()).noneMatch(highlight -> highlight.getGutterIconRenderer() != null));
                } finally { com.intellij.openapi.util.Disposer.dispose(viewer); }
            });
        } finally { service.clear(); }
    }

    public void testJavaDeclarationNavigationSurvivesAnalysisOnAnAlreadyOpenNativeDiff() throws Exception {
        ReviewSnapshot snapshot;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) {
            var json = com.google.gson.JsonParser.parseString(new String(input.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
            json.getAsJsonObject("analysis").getAsJsonArray("layers").get(0).getAsJsonObject().add("annotations",
                    com.google.gson.JsonParser.parseString("[{\"path\":\"src/main/java/demo/InvitationService.java\",\"side\":\"current\",\"start\":3,\"end\":3,\"title\":\"Accept invitation\",\"summary\":\"Invokes the unchanged method.\",\"partId\":\"service:part:0\"}]"));
            snapshot = ReviewSnapshot.parse(json.toString());
        }
        var service = getProject().getService(SemanticSnapshotService.class);
        String base = "/tmp/native-java-navigation";
        var file = VcsUtil.getFilePath(base + "/src/main/java/demo/InvitationService.java", false);
        var change = new com.intellij.collaboration.util.RefComparisonChange(new git4idea.GitRevisionNumber("b".repeat(40)), file, new git4idea.GitRevisionNumber("a".repeat(40)), file);
        var captured = new NativeGitLabBridge.Context(snapshot.url(), null, Path.of(base), java.util.Set.of(change), "a".repeat(40));
        EdtTestUtil.runInEdtAndWait(() -> {
            String code = "class InvitationService {\n void accept() {}\n void check() { accept(); }\n}\n";
            var psi = com.intellij.psi.PsiFileFactory.getInstance(getProject()).createFileFromText("InvitationService.java", com.intellij.ide.highlighter.JavaFileType.INSTANCE, code);
            var right = com.intellij.diff.DiffContentFactory.getInstance().create(getProject(), code, psi.getViewProvider().getVirtualFile());
            var left = com.intellij.diff.DiffContentFactory.getInstance().create(getProject(), code.replace("accept();", ""), psi.getViewProvider().getVirtualFile());
            var request = new com.intellij.diff.requests.SimpleDiffRequest("Native Java MR", left, right, "base", "head");
            request.putUserData(com.intellij.collaboration.util.RefComparisonChange.Companion.getKEY(), change);
            var holder = new com.intellij.openapi.util.UserDataHolderBase();
            var context = new com.intellij.diff.DiffContext() {
                @Override public com.intellij.openapi.project.Project getProject() { return SemanticGroupingPlatformTest.this.getProject(); }
                @Override public boolean isWindowFocused() { return false; }
                @Override public boolean isFocusedInWindow() { return false; }
                @Override public void requestFocusInWindow() { }
                @Override public <T> T getUserData(com.intellij.openapi.util.Key<T> key) { return holder.getUserData(key); }
                @Override public <T> void putUserData(com.intellij.openapi.util.Key<T> key, T value) { holder.putUserData(key, value); }
            };
            var viewer = new com.intellij.diff.tools.simple.SimpleDiffViewer(context, request);
            try {
                // Register before analysis, just as an already open MR diff is registered in IDEA.
                new SemanticDiffExtension().onViewerCreated(viewer, context, request); viewer.init();
                int offset = code.lastIndexOf("accept") + 1;
                viewer.getEditor2().getCaretModel().moveToOffset(offset);
                assertTrue("Original Java PSI exists", psi instanceof com.intellij.psi.PsiJavaFile);
                var diffPsi = com.intellij.psi.PsiDocumentManager.getInstance(getProject()).getPsiFile(right.getDocument());
                assertTrue("Native diff Java PSI exists: " + diffPsi, diffPsi instanceof com.intellij.psi.PsiJavaFile);
                var before = com.intellij.openapi.application.ReadAction.compute(() -> com.intellij.codeInsight.navigation.actions.GotoDeclarationAction.findTargetElement(getProject(), viewer.getEditor2(), offset));
                assertNotNull("Native Java diff can resolve the unchanged method", before);
                assertTrue(before instanceof com.intellij.psi.PsiMethod);
                service.installNative(snapshot, captured);
                assertTrue("Already-open native diff receives a hover note without reopening", java.util.Arrays.stream(viewer.getEditor2().getMarkupModel().getAllHighlighters()).anyMatch(item -> item.getGutterIconRenderer() != null));
                var after = com.intellij.openapi.application.ReadAction.compute(() -> com.intellij.codeInsight.navigation.actions.GotoDeclarationAction.findTargetElement(getProject(), viewer.getEditor2(), offset));
                assertSame("Analysis preserves declaration resolution", before, after);
                assertSame("Keep native content", right, request.getContents().get(1));
                assertSame("Keep native document", right.getDocument(), viewer.getEditor2().getDocument());
                assertSame("Keep native highlight file", psi.getViewProvider().getVirtualFile(), right.getHighlightFile());
                service.clear();
                var cleared = com.intellij.openapi.application.ReadAction.compute(() -> com.intellij.codeInsight.navigation.actions.GotoDeclarationAction.findTargetElement(getProject(), viewer.getEditor2(), offset));
                assertSame(before, cleared);
            } finally { service.clear(); com.intellij.openapi.util.Disposer.dispose(viewer); }
        });
    }

    public void testInlineSummaryFollowsGroupLayerAndFileMemberships() throws Exception {
        ReviewSnapshot snapshot;
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) { snapshot = ReviewSnapshot.parse(new String(input.readAllBytes(), StandardCharsets.UTF_8)); }
        var state = new SemanticSnapshotService.State(snapshot, "/tmp/inline-summary", java.util.Map.of());
        EdtTestUtil.runInEdtAndWait(() -> {
            var panel = new InlineSemanticSummary();
            panel.showSelection(state, snapshot.layerGroups().get("service"));
            assertTrue(panel.isVisible());
            assertTrue(panel.text.getText().contains("Expose validation result"));
            assertTrue(panel.text.getText().contains("Validate token expiry"));
            assertFalse(panel.text.getText().contains("Add a regression check"));
            panel.showSelection(state, snapshot.primaryLayers().get("src/main/java/demo/InvitationService.java"));
            assertTrue(panel.text.getText().contains("Check expiry"));
            assertFalse(panel.text.getText().contains("Return the service validation result"));
            var file = VcsUtil.getFilePath("/tmp/inline-summary/src/main/java/demo/InvitationService.java", false);
            var change = new com.intellij.collaboration.util.RefComparisonChange(new git4idea.GitRevisionNumber("b".repeat(40)), null, new git4idea.GitRevisionNumber("a".repeat(40)), file);
            panel.showSelection(state, change);
            assertTrue("File summaries show every layer membership", panel.text.getText().contains("Return the service validation result"));
            assertTrue(panel.text.getText().contains("Validate token expiry"));
            panel.showSelection(null, change); assertFalse(panel.isVisible());
        });
    }

    public void testResetRestoresGroupingFromBeforeAnalysis() {
        EdtTestUtil.runInEdtAndWait(() -> {
            var service = getProject().getService(SemanticSnapshotService.class);
            var tree = new com.intellij.openapi.vcs.changes.ui.ChangesTree(getProject(), false, false) { @Override public void rebuildTree() {} };
            tree.getGroupingSupport().set("directory", true);
            var previous = java.util.Set.copyOf(tree.getGroupingSupport().getGroupingKeys());
            service.rememberGrouping(tree); AnalyzeGitLabAction.enableGrouping(tree);
            assertTrue(tree.getGroupingSupport().getGroupingKeys().contains("cstack.semantic"));
            // Reanalysis must not overwrite the pre-analysis grouping snapshot.
            service.rememberGrouping(tree); service.clear();
            assertEquals(previous, tree.getGroupingSupport().getGroupingKeys());
        });
    }

    private static <T extends Component> T find(Component component, Class<T> type, String label) {
        if (type.isInstance(component) && (label == null || component instanceof JButton button && label.equals(button.getText()))) return type.cast(component);
        if (component instanceof Container parent) for (Component child : parent.getComponents()) {
            T result = find(child, type, label);
            if (result != null) return result;
        }
        return null;
    }
}
