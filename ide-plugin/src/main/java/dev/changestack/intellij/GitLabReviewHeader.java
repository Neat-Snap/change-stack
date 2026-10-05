package dev.changestack.intellij;

import com.intellij.ide.DataManager;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.components.Service;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vcs.changes.ui.ChangesTree;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ex.ToolWindowManagerListener;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.content.*;
import com.intellij.util.ui.JBUI;
import javax.swing.*;
import javax.swing.event.TreeSelectionListener;
import java.awt.*;
import java.awt.event.*;
import java.beans.PropertyChangeListener;
import java.util.*;
import java.util.List;

/** Inserts a small panel beneath GitLab's MR title; never reparents native content or editors. */
@Service(Service.Level.PROJECT)
public final class GitLabReviewHeader implements Disposable {
    private final Project project;
    private final Map<Content, Observer> observers = new IdentityHashMap<>();
    private final Set<ContentManager> attached = Collections.newSetFromMap(new IdentityHashMap<>());
    public GitLabReviewHeader(Project project) { this.project = project; }
    void attach(ToolWindow window) {
        ContentManager manager = window.getContentManager();
        if (!attached.add(manager)) return;
        ContentManagerListener listener = new ContentManagerListener() {
            @Override public void contentAdded(ContentManagerEvent event) { observe(event.getContent()); }
            @Override public void contentRemoved(ContentManagerEvent event) { var observer = observers.remove(event.getContent()); if (observer != null) observer.close(); }
        };
        manager.addContentManagerListener(listener);
        Disposer.register(this, () -> { if (!manager.isDisposed()) manager.removeContentManagerListener(listener); });
        for (var content : manager.getContents()) observe(content);
    }
    private void observe(Content content) {
        if (!project.isDisposed()) observers.computeIfAbsent(content, Observer::new);
    }
    @Override public void dispose() { for (var observer : observers.values()) observer.close(); observers.clear(); attached.clear(); }

    /** Loading/navigation replaces native child components. React to those events, with no polling. */
    private final class Observer {
        final Content content;
        final Set<Container> watched = Collections.newSetFromMap(new IdentityHashMap<>());
        final Map<ChangesTree, Header> headers = new IdentityHashMap<>();
        boolean queued, closed;
        final ContainerListener children = new ContainerAdapter() {
            @Override public void componentAdded(ContainerEvent event) { watch(event.getChild()); schedule(); }
            @Override public void componentRemoved(ContainerEvent event) { unwatch(event.getChild()); schedule(); }
        };
        final HierarchyListener visibility = event -> { if ((event.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) != 0) schedule(); };
        final PropertyChangeListener property = this::contentChanged;
        void contentChanged(java.beans.PropertyChangeEvent event) {
            if ("component".equals(event.getPropertyName())) { if (event.getOldValue() instanceof Component old) unwatch(old); watch(content.getComponent()); schedule(); }
        }
        Observer(Content content) { this.content = content; content.addPropertyChangeListener(property); watch(content.getComponent()); scan(); }
        void watch(Component component) {
            if (!(component instanceof Container container) || "ChangeStack.GitLab.AnalysisHeader".equals(component.getName()) || !watched.add(container)) return;
            container.addContainerListener(children); container.addHierarchyListener(visibility);
            for (var child : container.getComponents()) watch(child);
        }
        void unwatch(Component component) {
            if (!(component instanceof Container container) || !watched.remove(container)) return;
            container.removeContainerListener(children); container.removeHierarchyListener(visibility);
            for (var child : container.getComponents()) unwatch(child);
        }
        void schedule() {
            if (closed || queued) return; queued = true;
            SwingUtilities.invokeLater(() -> { queued = false; if (!closed && !project.isDisposed()) scan(); });
        }
        void scan() {
            Set<ChangesTree> current = Collections.newSetFromMap(new IdentityHashMap<>());
            collect(content.getComponent(), current);
            headers.entrySet().removeIf(entry -> { if (current.contains(entry.getKey())) return false; entry.getValue().close(); return true; });
        }
        void collect(Component component, Set<ChangesTree> current) {
            if (!component.isVisible() || "ChangeStack.GitLab.AnalysisHeader".equals(component.getName())) return;
            if (component instanceof ChangesTree tree) {
                // Only a native MR details provider qualifies. A selected row in the MR list does not.
                for (Container parent = tree.getParent(); parent != null; parent = parent.getParent()) {
                    if (!(parent instanceof JComponent panel) || (parent.getLayout() == null || !parent.getLayout().getClass().getName().equals("net.miginfocom.swing.MigLayout"))) continue;
                    String url = NativeGitLabBridge.detailsPanelUrl(panel);
                    if (url == null) continue;
                    current.add(tree); headers.computeIfAbsent(tree, ignored -> new Header(panel, tree, url)); break;
                }
                return;
            }
            if (component instanceof Container container) for (var child : container.getComponents()) collect(child, current);
        }
        void close() { closed = true; content.removePropertyChangeListener(property); unwatch(content.getComponent()); for (var header : headers.values()) header.close(); headers.clear(); }
    }

    private final class Header {
        final JComponent nativePanel;
        final ChangesTree tree;
        final String url;
        final JPanel bar = new JPanel(new BorderLayout(6, 4));
        final JButton analyze = new JButton("Analyze MR", com.intellij.icons.AllIcons.Actions.Execute);
        final JButton cancel = new JButton("Cancel");
        final JButton reset = new JButton("Reset review", com.intellij.icons.AllIcons.Actions.Refresh);
        final JBLabel status = new JBLabel();
        final JProgressBar progress = new JProgressBar();
        final InlineSemanticSummary summary = new InlineSemanticSummary();
        final SemanticSnapshotService service = project.getService(SemanticSnapshotService.class);
        final Runnable listener = this::update;
        final Runnable activityListener = this::updateActivity;
        final javax.swing.Timer clock = new javax.swing.Timer(500, event -> updateActivity());
        final TreeSelectionListener selection = event -> updateSummary();
        Header(JComponent nativePanel, ChangesTree tree, String url) {
            this.nativePanel = nativePanel; this.tree = tree; this.url = url;
            bar.setName("ChangeStack.GitLab.AnalysisHeader"); bar.setBorder(JBUI.Borders.empty(4, 6));
            JPanel controls = new JPanel(new BorderLayout(4, 0));
            JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEADING, 3, 0));
            JButton settings = new JButton(com.intellij.icons.AllIcons.General.Settings);
            settings.setToolTipText("Analysis settings: model and CA certificate"); settings.getAccessibleContext().setAccessibleName("Analysis settings");
            analyze.setToolTipText("Analyze this GitLab merge request"); reset.setToolTipText("Restore native file grouping and remove semantic notes");
            buttons.add(analyze); buttons.add(cancel); controls.add(buttons); controls.add(settings, BorderLayout.EAST);
            var activity = new JPanel(new BorderLayout(6, 0)); progress.setPreferredSize(new Dimension(50, 12));
            activity.add(progress, BorderLayout.WEST); activity.add(status);
            JPanel top = new JPanel(new BorderLayout(0, 4)); top.add(controls, BorderLayout.NORTH); top.add(activity);
            bar.add(top, BorderLayout.NORTH); bar.add(summary); bar.add(reset, BorderLayout.SOUTH);
            // Native details use a flowY MigLayout. Index 1 places us directly below the title.
            nativePanel.add(bar, "growx, shrinkprioy 200", Math.min(1, nativePanel.getComponentCount()));
            analyze.addActionListener(event -> AnalyzeGitLabAction.start(project, DataManager.getInstance().getDataContext(tree)));
            settings.addActionListener(event -> AnalysisSettings.get().configure(project));
            cancel.addActionListener(event -> { service.cancelAnalysis(); service.reportProgress("Cancelling analysis…"); });
            reset.addActionListener(event -> { service.clear(); service.reportProgress("Semantic review reset · native GitLab grouping restored"); });
            tree.addTreeSelectionListener(selection); service.addListener(listener); service.addProgressListener(activityListener);
            update(); nativePanel.revalidate(); nativePanel.repaint();
        }
        boolean matches() {
            var state = service.getState();
            if (state == null || !state.snapshot().url().equals(url) || !service.isNative()) return false;
            var nodes = tree.getRoot().depthFirstEnumeration();
            while (nodes.hasMoreElements()) {
                Object value = ((javax.swing.tree.DefaultMutableTreeNode) nodes.nextElement()).getUserObject();
                if (NativeGitLabBridge.isChange(value) && service.accepts(value)) return true;
            }
            return false;
        }
        void updateSummary() { summary.showSelection(matches() ? service.getState() : null, tree.getLastSelectedPathComponent()); nativePanel.revalidate(); }
        void update() { if (project.isDisposed()) { clock.stop(); return; } updateActivity(); updateSummary(); reset.setVisible(matches()); }
        void updateActivity() {
            var activity = service.activity(); boolean active = url.equals(activity.url());
            boolean running = active && activity.running(); analyze.setEnabled(!service.isRunning()); cancel.setVisible(running);
            progress.setVisible(running); progress.setIndeterminate(running);
            long seconds = Math.max(0, (System.nanoTime() - activity.startedNanos()) / 1_000_000_000);
            status.setText(active ? activity.message() + (running ? " · " + seconds + "s" : "") : "Ready to analyze this MR");
            status.setToolTipText(status.getText());
            if (running) { if (!clock.isRunning()) clock.start(); } else clock.stop();
        }
        void close() {
            clock.stop(); tree.removeTreeSelectionListener(selection); service.removeListener(listener); service.removeProgressListener(activityListener);
            nativePanel.remove(bar); nativePanel.revalidate(); nativePanel.repaint();
        }
    }
    public static final class WindowListener implements ToolWindowManagerListener {
        @Override public void toolWindowShown(ToolWindow window) {
            if (!window.isDisposed() && (window.getId().equals("Merge Requests") || window.getId().equals("GitLab"))) window.getProject().getService(GitLabReviewHeader.class).attach(window);
        }
    }
}
