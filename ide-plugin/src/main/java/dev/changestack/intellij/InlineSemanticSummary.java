package dev.changestack.intellij;

import com.intellij.openapi.util.text.StringUtil;
import javax.swing.*;
import javax.swing.tree.DefaultMutableTreeNode;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.nio.file.Path;
import java.util.List;

/** Selection-driven explanation inside the native MR details panel. */
final class InlineSemanticSummary extends JPanel {
    final JEditorPane text = new JEditorPane("text/html", "");
    InlineSemanticSummary() {
        super(new BorderLayout()); setName("ChangeStack.GitLab.InlineSummary");
        text.setEditable(false); text.setOpaque(false); text.putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, true);
        var scroll = new JScrollPane(text); scroll.setBorder(null); scroll.setPreferredSize(new Dimension(0, 140));
        scroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        add(scroll); setVisible(false);
    }
    void showSelection(SemanticSnapshotService.State state, Object selected) {
        if (state == null) { setVisible(false); return; }
        var snapshot = state.snapshot();
        Object value = selected instanceof DefaultMutableTreeNode node ? node.getUserObject() : selected;
        String title = "Review overview", lead = snapshot.summary();
        List<ReviewSnapshot.Layer> layers = List.of();
        if (value instanceof ReviewSnapshot.GroupKey group) {
            title = group.label(); lead = "";
            var member = snapshot.groups().stream().filter(item -> item.id().equals(group.id())).findFirst();
            if (member.isPresent()) layers = snapshot.layers().stream().filter(item -> member.get().layers().contains(item.id())).toList();
        } else if (value instanceof ReviewSnapshot.LayerKey layer) {
            layers = snapshot.layers().stream().filter(item -> item.id().equals(layer.id())).toList();
            title = layer.label(); lead = "";
        } else {
            String absolute = NativeGitLabBridge.changePath(value);
            if (absolute != null && Path.of(absolute).startsWith(Path.of(state.repositoryRoot()))) {
                String path = Path.of(state.repositoryRoot()).relativize(Path.of(absolute)).toString().replace('\\', '/');
                title = path; lead = "";
                layers = snapshot.layers().stream().filter(item -> item.files().contains(path)).toList();
                if (layers.isEmpty()) lead = "No semantic layer was assigned to this file.";
            }
        }
        StringBuilder html = new StringBuilder("<html><body><b>").append(escape(title)).append("</b>");
        if (!lead.isBlank()) html.append("<p>").append(escape(lead)).append("</p>");
        for (var layer : layers) {
            html.append("<p><b>").append(escape(layer.title())).append("</b><br>").append(escape(layer.summary())).append("</p>");
            if (!(value instanceof ReviewSnapshot.GroupKey)) for (var part : layer.parts()) {
                html.append("<p>").append(escape(part.title())).append(": ").append(escape(part.summary())).append("</p>");
            }
            if (!layer.dependsOn().isEmpty()) {
                var dependencies = snapshot.layers().stream().filter(item -> layer.dependsOn().contains(item.id())).map(ReviewSnapshot.Layer::title).toList();
                html.append("<p>Depends on: ").append(escape(String.join(", ", dependencies))).append("</p>");
            }
        }
        if (!snapshot.warnings().isEmpty()) html.append("<p><b>Analysis notes</b><br>").append(escape(String.join("\n", snapshot.warnings()))).append("</p>");
        text.setText(html.append("</body></html>").toString()); text.setCaretPosition(0); setVisible(true);
    }
    private static String escape(String text) { return StringUtil.escapeXmlEntities(text).replace("\n", "<br>"); }
}
