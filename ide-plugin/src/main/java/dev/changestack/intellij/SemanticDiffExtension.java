package dev.changestack.intellij;

import com.intellij.diff.*;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.diff.tools.util.base.*;
import com.intellij.diff.tools.simple.SimpleDiffViewer;
import com.intellij.diff.tools.fragmented.UnifiedDiffViewer;
import com.intellij.diff.util.Side;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.markup.*;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.text.StringUtil;
import javax.swing.SwingUtilities;
import java.nio.file.Path;
import java.util.*;

/** Hover-only notes on native editors. No text attributes, navigation actions or content replacement. */
public final class SemanticDiffExtension extends DiffExtension {
    @Override public void onViewerCreated(FrameDiffTool.DiffViewer viewer, DiffContext context, DiffRequest request) {
        if (context.getProject() == null || !(viewer instanceof DiffViewerBase base)) return;
        Object change = NativeGitLabBridge.diffChange(request);
        if (change == null) return;
        var service = context.getProject().getService(SemanticSnapshotService.class);
        String absolute = NativeGitLabBridge.changePath(change);
        if (absolute == null) return;
        List<RangeHighlighter> highlights = new ArrayList<>();
        Runnable update = () -> {
            if (base.isDisposed()) return;
            highlights.forEach(RangeHighlighter::dispose); highlights.clear();
            var state = service.getState();
            if (state == null || !service.isNative() || !service.accepts(change)) return;
            Path file = Path.of(absolute), root = Path.of(state.repositoryRoot());
            if (!file.startsWith(root)) return;
            String path = root.relativize(file).toString().replace('\\', '/');
            // One note for each semantic part in this file. Prefer the current side; deleted-only parts use old.
            for (var layer : state.snapshot().layers()) {
                Map<String, ReviewSnapshot.Annotation> parts = new LinkedHashMap<>();
                for (var annotation : layer.annotations()) {
                    if (!annotation.path().equals(path)) continue;
                    String key = annotation.partId().isBlank() ? annotation.title() + "\n" + annotation.summary() : annotation.partId();
                    var previous = parts.get(key);
                    if (previous == null || previous.side().equals("old") && annotation.side().equals("current")) parts.put(key, annotation);
                }
                for (var annotation : parts.values()) {
                    if (highlights.size() >= 100) return;
                    Side side = annotation.side().equals("old") ? Side.LEFT : Side.RIGHT;
                    Editor editor;
                    int line = annotation.start() - 1;
                    if (base instanceof SimpleDiffViewer simple) editor = simple.getEditor(side);
                    else if (base instanceof UnifiedDiffViewer unified) { editor = unified.getEditor(); line = unified.transferLineToOnesideStrict(side, line); }
                    else continue;
                    if (line < 0 || line >= editor.getDocument().getLineCount()) continue;
                    var highlight = editor.getMarkupModel().addLineHighlighter(line, HighlighterLayer.ADDITIONAL_SYNTAX, null);
                    highlight.setGutterIconRenderer(new GutterIconRenderer() {
                        @Override public javax.swing.Icon getIcon() { return com.intellij.icons.AllIcons.General.Information; }
                        @Override public String getTooltipText() {
                            return "<html><body width=\"360\"><b>" + escape(annotation.title()) + "</b><br>" + escape(layer.title()) +
                                    "<br><br>" + escape(annotation.summary()).replace("\n", "<br>") + "</body></html>";
                        }
                        @Override public boolean isNavigateAction() { return false; }
                        @Override public boolean equals(Object other) { return this == other; }
                        @Override public int hashCode() { return System.identityHashCode(this); }
                    });
                    highlights.add(highlight);
                }
            }
        };
        Runnable listener = () -> { if (SwingUtilities.isEventDispatchThread()) update.run(); else SwingUtilities.invokeLater(update); };
        service.addListener(listener);
        base.addListener(new DiffViewerListener() { @Override protected void onInit() { listener.run(); } @Override protected void onAfterRediff() { listener.run(); } });
        Disposer.register(base, () -> { service.removeListener(listener); highlights.forEach(RangeHighlighter::dispose); });
    }
    private static String escape(String text) { return StringUtil.escapeXmlEntities(text); }
}
