package dev.changestack.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.ui.components.*;
import javax.swing.*;
import javax.swing.tree.*;
import java.awt.BorderLayout;

/** A native IDEA dialog reached from the MR tree and diff; no replacement review surface. */
final class SemanticExplanationDialog extends DialogWrapper {
    record Entry(String title, String text) { @Override public String toString() { return title; } }
    private final ReviewSnapshot snapshot;
    private final String path, layerId;
    private SemanticExplanationDialog(Project project, ReviewSnapshot snapshot, String path, String layerId) {
        super(project, false); this.snapshot = snapshot; this.path = path; this.layerId = layerId;
        setTitle(path == null ? "Semantic Review · " + snapshot.title() : "Semantic Explanation · " + path);
        setModal(false); setOKButtonText("Close"); init();
    }
    static void show(Project project, ReviewSnapshot snapshot, String path, String layerId) { new SemanticExplanationDialog(project, snapshot, path, layerId).show(); }
    @Override protected Action[] createActions() { return new Action[]{getOKAction()}; }
    @Override protected JComponent createCenterPanel() {
        DefaultMutableTreeNode root = new DefaultMutableTreeNode("Review");
        String overview = snapshot.summary() + "\n\n" + snapshot.url() + "\nHead: " + snapshot.headSha()
                + "\nAnalysis: " + snapshot.source() + (snapshot.warnings().isEmpty() ? "" : "\n\nWarnings:\n" + String.join("\n", snapshot.warnings()));
        root.add(new DefaultMutableTreeNode(new Entry("Review overview", overview)));
        java.util.Map<String, DefaultMutableTreeNode> groups = new java.util.LinkedHashMap<>();
        for (ReviewSnapshot.Group group : snapshot.groups()) {
            var node = new DefaultMutableTreeNode(new Entry(group.title(), group.title()));
            for (String member : group.layers()) groups.put(member, node);
        }
        for (ReviewSnapshot.Layer layer : snapshot.layers()) {
            if (path != null && !layer.files().contains(path)) continue;
            if (layerId != null && !layer.id().equals(layerId)) continue;
            StringBuilder text = new StringBuilder(layer.summary());
            if (!layer.dependsOn().isEmpty()) {
                text.append("\n\nBuilds on:");
                for (ReviewSnapshot.Layer dependency : snapshot.layers()) if (layer.dependsOn().contains(dependency.id())) text.append("\n• ").append(dependency.title());
            }
            text.append("\n\nFiles:\n").append(String.join("\n", layer.files()));
            var node = new DefaultMutableTreeNode(new Entry(layer.title(), text.toString()));
            for (ReviewSnapshot.Part part : layer.parts()) node.add(new DefaultMutableTreeNode(new Entry(part.title(), part.summary())));
            var group = groups.get(layer.id());
            if (group == null) root.add(node);
            else { if (group.getParent() == null) root.add(group); group.add(node); }
        }
        JTree tree = new JTree(root); tree.setRootVisible(false); tree.setShowsRootHandles(true);
        JBTextArea text = new JBTextArea(overview); text.setEditable(false); text.setLineWrap(true); text.setWrapStyleWord(true);
        tree.addTreeSelectionListener(event -> { if (tree.getLastSelectedPathComponent() instanceof DefaultMutableTreeNode node && node.getUserObject() instanceof Entry value) { text.setText(value.text()); text.setCaretPosition(0); } });
        for (int row = 0; row < tree.getRowCount(); row++) tree.expandRow(row);
        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, new JBScrollPane(tree), new JBScrollPane(text)); split.setResizeWeight(0.35);
        JPanel panel = new JPanel(new BorderLayout(6, 6)); panel.add(split);
        panel.add(new JBLabel("Review and comment through GitLab's native diff. Files can belong to several semantic layers."), BorderLayout.SOUTH);
        panel.setPreferredSize(new java.awt.Dimension(860, 520)); return panel;
    }
}
