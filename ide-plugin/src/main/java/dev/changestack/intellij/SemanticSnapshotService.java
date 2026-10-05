package dev.changestack.intellij;

import com.intellij.openapi.components.Service;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

@Service(Service.Level.PROJECT)
public final class SemanticSnapshotService implements com.intellij.openapi.Disposable {
    public record State(ReviewSnapshot snapshot, String repositoryRoot, Map<String, ReviewSnapshot.LayerKey> pathToLayer) {}
    private volatile State state;
    private volatile Set<Object> nativeChanges;
    private final AtomicBoolean running = new AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicLong generation = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.List<Runnable> listeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    public record Activity(String url, String message, long startedNanos, boolean running) {}
    private volatile Activity activity = new Activity("", "Ready to analyze the open GitLab MR", 0, false);
    private volatile com.intellij.openapi.progress.ProgressIndicator indicator;
    private final AtomicBoolean cancellation = new AtomicBoolean();
    private final AtomicBoolean progressQueued = new AtomicBoolean();
    private final java.util.List<Runnable> progressListeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    Activity activity() { return activity; }
    void addProgressListener(Runnable listener) { progressListeners.add(listener); }
    void removeProgressListener(Runnable listener) { progressListeners.remove(listener); }
    private void progressChanged() {
        if (!progressQueued.compareAndSet(false, true)) return;
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater(() -> {
            progressQueued.set(false);
            for (Runnable listener : progressListeners) listener.run();
        });
    }
    void bindIndicator(com.intellij.openapi.progress.ProgressIndicator value) {
        indicator = value;
        if (cancellation.get()) value.cancel();
    }
    void reportProgress(String message) {
        Activity current = activity;
        activity = new Activity(current.url(), message, current.startedNanos(), current.running());
        progressChanged();
    }
    void cancelAnalysis() { cancellation.set(true); var current = indicator; if (current != null) current.cancel(); }
    void addListener(Runnable listener) { listeners.add(listener); }
    void removeListener(Runnable listener) { listeners.remove(listener); }
    private void changed() { for (Runnable listener : listeners) listener.run(); }

    public State getState() { return state; }
    private final Map<com.intellij.openapi.vcs.changes.ui.ChangesTree, Set<String>> originalGrouping = new java.util.WeakHashMap<>();
    void rememberGrouping(com.intellij.openapi.vcs.changes.ui.ChangesTree tree) {
        originalGrouping.computeIfAbsent(tree, ignored -> Set.copyOf(tree.getGroupingSupport().getGroupingKeys()));
    }
    public void clear() {
        cancelAnalysis(); generation.incrementAndGet(); state = null; nativeChanges = null;
        for (var entry : originalGrouping.entrySet()) {
            var tree = entry.getKey();
            for (String key : new java.util.ArrayList<>(tree.getGroupingSupport().getGroupingKeys())) tree.getGroupingSupport().set(key, false);
            for (String key : entry.getValue()) tree.getGroupingSupport().set(key, true);
            tree.rebuildTree();
        }
        originalGrouping.clear(); changed();
    }
    boolean beginAnalysis(String url) {
        if (!running.compareAndSet(false, true)) return false;
        generation.incrementAndGet(); cancellation.set(false);
        activity = new Activity(url, "Starting analysis · using IDEA's GitLab account", System.nanoTime(), true);
        progressChanged(); return true;
    }
    long generation() { return generation.get(); }
    void finishAnalysis(String message) {
        indicator = null; running.set(false);
        Activity current = activity;
        activity = new Activity(current.url(), message, current.startedNanos(), false); progressChanged();
    }
    @Override public void dispose() { cancelAnalysis(); listeners.clear(); progressListeners.clear(); }
    boolean isRunning() { return running.get(); }
    boolean accepts(Object nativeChange) { Set<Object> allowed = nativeChanges; return allowed == null || allowed.contains(nativeChange); }
    boolean isNative() { return nativeChanges != null; }
    void installNative(ReviewSnapshot snapshot, NativeGitLabBridge.Context context) {
        install(snapshot, context.root());
        nativeChanges = context.changes();
        changed();
    }

    public void install(ReviewSnapshot snapshot, Path repositoryRoot) {
        nativeChanges = null;
        Path root = repositoryRoot.toAbsolutePath().normalize();
        Map<String, ReviewSnapshot.LayerKey> paths = new LinkedHashMap<>();
        snapshot.primaryLayers().forEach((relative, layer) -> paths.put(root.resolve(relative).normalize().toString().replace('\\', '/'), layer));
        state = new State(snapshot, root.toString(), Map.copyOf(paths));
    }
}
