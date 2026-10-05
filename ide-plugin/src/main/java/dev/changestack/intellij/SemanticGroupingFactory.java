package dev.changestack.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.changes.ui.*;
import org.jetbrains.annotations.NotNull;
import javax.swing.tree.DefaultTreeModel;
import java.util.*;

/** Adds two helper levels while leaving GitLab's native change leaves intact. */
public final class SemanticGroupingFactory extends ChangesGroupingPolicyFactory {
    @Override public @NotNull ChangesGroupingPolicy createGroupingPolicy(@NotNull Project project, @NotNull DefaultTreeModel model) {
        var service = project.getService(SemanticSnapshotService.class);
        var state = service.getState();
        var paths = state == null ? Map.<String, ReviewSnapshot.LayerKey>of() : state.pathToLayer();
        var groups = state == null ? Map.<String, ReviewSnapshot.GroupKey>of() : state.snapshot().layerGroups();
        return new BaseChangesGroupingPolicy() {
            final Map<ChangesBrowserNode<?>, Map<Object, ChangesBrowserNode<?>>> cache = new IdentityHashMap<>();
            @Override public ChangesBrowserNode<?> getParentNodeFor(@NotNull StaticFilePath path, @NotNull ChangesBrowserNode<?> node, @NotNull ChangesBrowserNode<?> root) {
                var next = getNextPolicy();
                var parent = next == null ? null : next.getParentNodeFor(path, node, root);
                if (!service.accepts(node.getUserObject())) return parent;
                var layer = paths.get(path.getPath().replace('\\', '/'));
                if (layer == null) return parent;
                if (parent == null) parent = root;
                var group = groups.get(layer.id());
                if (group != null) parent = cached(parent, group, new GroupNode(group));
                return cached(parent, layer, new LayerNode(layer));
            }
            private ChangesBrowserNode<?> cached(ChangesBrowserNode<?> parent, Object key, ChangesBrowserNode<?> candidate) {
                return cache.computeIfAbsent(parent, ignored -> new HashMap<>()).computeIfAbsent(key, ignored -> {
                    model.insertNodeInto(candidate, parent, parent.getChildCount());
                    markCachingRoot(candidate);
                    return candidate;
                });
            }
        };
    }
    private static final class LayerNode extends ChangesBrowserNode<ReviewSnapshot.LayerKey> {
        LayerNode(ReviewSnapshot.LayerKey value) { super(value); markAsHelperNode(); }
        @Override public @NotNull String getTextPresentation() { return getUserObject().label(); }
        @Override public int getSortWeight() { return 100; }
        @Override public int compareUserObjects(ReviewSnapshot.LayerKey other) { return Integer.compare(getUserObject().rank(), other.rank()); }
    }
    private static final class GroupNode extends ChangesBrowserNode<ReviewSnapshot.GroupKey> {
        GroupNode(ReviewSnapshot.GroupKey value) { super(value); markAsHelperNode(); }
        @Override public @NotNull String getTextPresentation() { return getUserObject().label(); }
        @Override public int getSortWeight() { return 90; }
        @Override public int compareUserObjects(ReviewSnapshot.GroupKey other) { return Integer.compare(getUserObject().rank(), other.rank()); }
    }
}
