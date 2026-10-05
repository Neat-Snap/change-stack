package dev.changestack.intellij;

import com.intellij.ide.DataManager;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.changes.ui.ChangesTree;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.openapi.util.UserDataHolder;
import com.intellij.openapi.util.Key;
import kotlin.ResultKt;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.coroutines.intrinsics.IntrinsicsKt;
import org.jetbrains.annotations.NotNull;

import java.awt.Component;
import java.awt.Container;
import java.lang.reflect.Method;
import java.net.URI;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import git4idea.repo.GitRepositoryManager;

/** The only version-sensitive adapter. GitLab's MR context and account APIs are internal.
 * Reflection accommodates the String -> GitLabCredentials transition without copying credentials stores. */
final class NativeGitLabBridge {
    static final String DETAILS_KEY = "GitLab.MergeRequest.Details.Controller";
    static final String SELECTED_KEY = "org.jetbrains.plugins.gitlab.mergerequest.selected";
    private static final DataKey<Object> DETAILS = DataKey.create(DETAILS_KEY), SELECTED = DataKey.create(SELECTED_KEY);
    record Context(String url, ChangesTree tree, Path root, Set<Object> changes, String headSha) {}
    record Account(Object nativeAccount, String name, String baseUrl) { @Override public String toString() { return name + " · " + baseUrl; } }

    // GitLab registers its details VM locally under this Swing property in 253–262.
    // Inspect only that panel's provider; an inherited MR-list selection must not qualify.
    static String detailsPanelUrl(javax.swing.JComponent panel) {
        Object value = panel.getClientProperty("DataProvider");
        if (!(value instanceof DataProvider)) return null;
        return reviewUrl(DataManager.getInstance().getDataContext(panel));
    }
    static Object data(DataContext context, String key) { return DataKey.create(key).getData(context); }
    static String reviewUrl(DataContext context) {
        Object details = DETAILS.getData(context);
        if (details != null) return string(details, "getUrl");
        Object selected = SELECTED.getData(context);
        return selected == null ? null : string(selected, "getWebUrl");
    }

    static Context capture(Project project, DataContext dataContext) {
        String url = reviewUrl(dataContext);
        ChangesTree tree = ancestor(PlatformDataKeys.CONTEXT_COMPONENT.getData(dataContext));
        if (tree == null) {
            var window = ToolWindowManager.getInstance(project).getToolWindow("Merge Requests");
            if (window != null) for (var content : window.getContentManager().getContents()) {
                tree = findTree(content.getComponent(), url);
                if (tree != null) break;
            }
        }
        if (tree == null) throw new IllegalArgumentException("Open a GitLab MR and wait for its changed-files tree to load, then click Analyze MR.");
        DataContext treeContext = DataManager.getInstance().getDataContext(tree);
        if (url == null) url = reviewUrl(treeContext);
        if (url == null) throw new IllegalArgumentException("Open a GitLab merge request before starting analysis.");
        Set<Object> changes = Collections.newSetFromMap(new IdentityHashMap<>());
        Set<String> heads = new HashSet<>();
        var nodes = tree.getRoot().depthFirstEnumeration();
        while (nodes.hasMoreElements()) {
            var node = (javax.swing.tree.DefaultMutableTreeNode) nodes.nextElement();
            Object change = node.getUserObject();
            if (change == null || !isChange(change)) continue;
            changes.add(change);
            String head = revisionAfter(change);
            if (head != null && head.matches("[0-9a-fA-F]{40,64}")) heads.add(head);
        }
        if (changes.isEmpty()) throw new IllegalArgumentException("Wait for GitLab's changed files to finish loading.");
        if (heads.isEmpty()) {
            Object details = DETAILS.getData(treeContext);
            String loadedHead = headFromDetails(details == null ? DETAILS.getData(dataContext) : details);
            if (loadedHead != null) heads.add(loadedHead);
        }
        if (heads.size() != 1) throw new IllegalArgumentException("Select All commits in GitLab's review before analyzing. The loaded MR head could not be verified.");
        String samplePath = changePath(changes.iterator().next());
        Path root = null;
        for (var repository : GitRepositoryManager.getInstance(project).getRepositories()) {
            Path candidate = Path.of(repository.getRoot().getPath());
            if (samplePath != null && Path.of(samplePath).startsWith(candidate) && (root == null || candidate.getNameCount() > root.getNameCount())) root = candidate;
        }
        if (root == null) throw new IllegalArgumentException("The native review files do not belong to a Git repository open in this project.");
        return new Context(url, tree, root, changes, heads.iterator().next());
    }

    static boolean isChange(Object value) {
        if (value == null) return false;
        return value.getClass().getName().equals("com.intellij.collaboration.util.RefComparisonChange")
                || value instanceof com.intellij.openapi.vcs.changes.Change;
    }
    static String changePath(Object change) {
        if (change instanceof com.intellij.openapi.vcs.changes.Change old) {
            var revision = old.getAfterRevision() == null ? old.getBeforeRevision() : old.getAfterRevision();
            return revision == null ? null : revision.getFile().getPath();
        }
        Object path = optional(change, "getFilePathAfter");
        if (path == null) path = optional(change, "getFilePathBefore");
        return path == null ? null : string(path, "getPath");
    }
    static String revisionAfter(Object change) {
        if (change instanceof com.intellij.openapi.vcs.changes.Change old) return old.getAfterRevision() == null ? null : old.getAfterRevision().getRevisionNumber().asString();
        Object revision = optional(change, "getRevisionNumberAfter");
        return revision == null ? null : string(revision, "asString");
    }

    static List<Account> accounts(String reviewUrl) {
        Object manager = accountManager();
        Object values = invoke(invoke(manager, "getAccountsState"), "getValue");
        URI review = URI.create(reviewUrl);
        List<Account> accounts = new ArrayList<>();
        for (Object account : (Collection<?>) values) {
            String base = string(invoke(account, "getServer"), "getUri").replaceAll("/$", "");
            URI server = URI.create(base);
            if (Objects.equals(review.getScheme(), server.getScheme()) && Objects.equals(review.getHost(), server.getHost())
                    && review.getPort() == server.getPort() && review.getPath().startsWith(server.getPath().replaceAll("/$", "") + "/")) {
                accounts.add(new Account(account, string(account, "getName"), base));
            }
        }
        accounts.sort(Comparator.comparing(Account::toString));
        return accounts;
    }

    static String token(Account account, ProgressIndicator indicator) {
        Object manager = accountManager();
        AtomicReference<Object> completed = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        Continuation<Object> continuation = new Continuation<>() {
            @Override public @NotNull CoroutineContext getContext() { return EmptyCoroutineContext.INSTANCE; }
            @Override public void resumeWith(Object result) { completed.set(result); latch.countDown(); }
        };
        Object result = invoke(manager, "findCredentials", account.nativeAccount(), continuation);
        if (result == IntrinsicsKt.getCOROUTINE_SUSPENDED()) {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
            try {
                while (!latch.await(100, TimeUnit.MILLISECONDS)) {
                    indicator.checkCanceled();
                    if (System.nanoTime() > deadline) throw new IllegalArgumentException("GitLab credentials lookup timed out. Check the account in IDEA settings.");
                }
            } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new com.intellij.openapi.progress.ProcessCanceledException(); }
            result = completed.get(); ResultKt.throwOnFailure(result);
        }
        if (result == null) throw new IllegalArgumentException("This GitLab account needs login. Sign in through IDEA's GitLab settings.");
        return credentialToken(result);
    }
    static String credentialToken(Object result) {
        if (result instanceof String value && !value.isBlank()) return value;
        Object token = optional(result, "getAccessToken");
        if (token instanceof String value && !value.isBlank()) return value;
        throw new IllegalArgumentException("This account's credential type is unsupported. Use a GitLab token account in IDEA's GitLab settings.");
    }

    static Object diffChange(UserDataHolder request) {
        try {
            Class<?> type = Class.forName("com.intellij.collaboration.util.RefComparisonChange");
            Object companion = type.getField("Companion").get(null);
            @SuppressWarnings("unchecked") Key<Object> key = (Key<Object>) invoke(companion, "getKEY");
            return request.getUserData(key);
        } catch (ReflectiveOperationException | IllegalArgumentException error) { return null; }
    }

    private static Object accountManager() {
        try {
            Class<?> type = Class.forName("org.jetbrains.plugins.gitlab.authentication.accounts.GitLabAccountManager");
            Object manager = ApplicationManager.getApplication().getService(type);
            if (manager == null) throw new IllegalArgumentException("Enable JetBrains' GitLab plugin and sign in to GitLab first.");
            return manager;
        } catch (ClassNotFoundException error) { throw new IllegalArgumentException("JetBrains' bundled GitLab plugin is unavailable."); }
    }
    static Object invoke(Object receiver, String name, Object... arguments) {
        for (Method method : receiver.getClass().getMethods()) if (method.getName().equals(name) && method.getParameterCount() == arguments.length && !method.isBridge()) {
            try { method.setAccessible(true); return method.invoke(receiver, arguments); }
            catch (ReflectiveOperationException error) { throw new IllegalArgumentException("GitLab integration could not read " + name + ". Check the account and IDE build."); }
        }
        throw new IllegalArgumentException("This GitLab version does not expose " + name + ". Check the IDE build.");
    }
    static Object optional(Object receiver, String name) {
        if (receiver == null) return null;
        try { return invoke(receiver, name); } catch (IllegalArgumentException error) { return null; }
    }
    private static String headFromDetails(Object vm) {
        if (vm == null) return null;
        // Kotlin exposes a generated accessor used by GitLab's own child models.
        for (Method method : vm.getClass().getMethods()) if (method.getName().equals("access$getMergeRequest$p") && method.getParameterCount() == 1) {
            try {
                Object mr = method.invoke(null, vm);
                Object details = invoke(invoke(mr, "getDetails"), "getValue");
                return string(invoke(details, "getDiffRefs"), "getHeadSha");
            } catch (ReflectiveOperationException | IllegalArgumentException ignored) { return null; }
        }
        return null;
    }
    static String string(Object receiver, String name) { Object value = invoke(receiver, name); return value instanceof String text ? text : null; }
    private static ChangesTree ancestor(Component component) {
        for (Component value = component; value != null; value = value.getParent()) if (value instanceof ChangesTree tree) return tree;
        return null;
    }
    private static ChangesTree findTree(Component component, String url) {
        if (!component.isVisible()) return null;
        if (component instanceof ChangesTree tree) {
            String loaded = reviewUrl(DataManager.getInstance().getDataContext(tree));
            if (loaded != null && (url == null || url.equals(loaded))) return tree;
        }
        if (component instanceof Container container) for (Component child : container.getComponents()) {
            ChangesTree tree = findTree(child, url); if (tree != null) return tree;
        }
        return null;
    }
}
