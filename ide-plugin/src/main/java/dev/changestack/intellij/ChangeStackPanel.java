package dev.changestack.intellij;

import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextArea;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JSplitPane;
import javax.swing.JTree;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeModel;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Supplier;

final class ChangeStackPanel extends JPanel {
    private record Node(String label, String explanation, String file) { @Override public String toString() { return label; } }
    private final Project project;
    private final SemanticSnapshotService service;
    private final JBTextField repositoryRoot;
    private final JBLabel status = new JBLabel("Import analysis to start. No tokens are needed by this plugin.");
    private final JTree tree = new JTree(new DefaultMutableTreeNode("Review"));
    private final JBTextArea details = new JBTextArea();
    private final JButton openReview = new JButton("Open original review");
    private long importGeneration;

    ChangeStackPanel(Project project) {
        super(new BorderLayout(JBUI.scale(6), JBUI.scale(6)));
        this.project = project;
        this.service = project.getService(SemanticSnapshotService.class);
        setBorder(JBUI.Borders.empty(8));
        repositoryRoot = new JBTextField(project.getBasePath() == null ? "" : project.getBasePath());
        JPanel controls = new JPanel(new BorderLayout(4, 4));
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        JButton importButton = new JButton("Import analysis…"), sample = new JButton("Load sample"), clear = new JButton("Clear");
        buttons.add(importButton); buttons.add(sample); buttons.add(clear); buttons.add(openReview);
        controls.add(buttons, BorderLayout.NORTH);
        JPanel rootRow = new JPanel(new BorderLayout(4, 0));
        rootRow.add(new JBLabel("Repository root"), BorderLayout.WEST);
        rootRow.add(repositoryRoot, BorderLayout.CENTER);
        JButton chooseRoot = new JButton("Choose…"); rootRow.add(chooseRoot, BorderLayout.EAST);
        controls.add(rootRow, BorderLayout.CENTER);
        controls.add(status, BorderLayout.SOUTH);
        add(controls, BorderLayout.NORTH);
        tree.setRootVisible(false); tree.setShowsRootHandles(true);
        details.setEditable(false); details.setLineWrap(true); details.setWrapStyleWord(true); details.setBorder(JBUI.Borders.empty(8));
        JSplitPane split = new JSplitPane(JSplitPane.VERTICAL_SPLIT, new JBScrollPane(tree), new JBScrollPane(details));
        split.setResizeWeight(0.55); add(split, BorderLayout.CENTER);
        JBTextArea instructions = new JBTextArea("Native review tree: Group By → Semantic Layers. Toggle it off/on after importing or clearing analysis. Confirm the review URL and head commit below match the MR. Files stay whole in the native diff; this panel lists all layer memberships.");
        instructions.setEditable(false); instructions.setLineWrap(true); instructions.setWrapStyleWord(true); instructions.setOpaque(false);
        add(instructions, BorderLayout.SOUTH);
        importButton.addActionListener(event -> {
            VirtualFile file = FileChooser.chooseFile(FileChooserDescriptorFactory.createSingleFileDescriptor("json"), project, null);
            if (file != null) load(() -> {
                try {
                    Path path = Path.of(file.getPath());
                    if (Files.size(path) > 16 * 1024 * 1024) throw new IllegalArgumentException("Analysis file is too large (maximum 16 MB).");
                    return Files.readString(path, StandardCharsets.UTF_8);
                } catch (java.io.IOException error) { throw new IllegalArgumentException("Could not read the selected analysis file."); }
            });
        });
        sample.addActionListener(event -> load(() -> {
            try (InputStream stream = getClass().getResourceAsStream("/sample-analysis.json")) {
                if (stream == null) throw new IllegalArgumentException("Sample analysis is missing.");
                return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            } catch (java.io.IOException error) { throw new IllegalArgumentException("Could not load sample analysis."); }
        }));
        clear.addActionListener(event -> {
            importGeneration++; service.clear(); render();
            status.setText("Cleared · toggle Semantic Layers off/on to refresh native groups.");
        });
        chooseRoot.addActionListener(event -> {
            VirtualFile directory = FileChooser.chooseFile(FileChooserDescriptorFactory.createSingleFolderDescriptor(), project, null);
            if (directory != null) repositoryRoot.setText(directory.getPath());
        });
        openReview.addActionListener(event -> {
            SemanticSnapshotService.State state = service.getState();
            if (state != null && !state.snapshot().demo()) BrowserUtil.browse(state.snapshot().url());
        });
        tree.addTreeSelectionListener(event -> {
            Object selected = tree.getLastSelectedPathComponent();
            if (selected instanceof DefaultMutableTreeNode node && node.getUserObject() instanceof Node value) {
                details.setText(value.explanation); details.setCaretPosition(0);
            }
        });
        tree.addMouseListener(new MouseAdapter() {
            @Override public void mouseClicked(MouseEvent event) {
                if (event.getClickCount() != 2) return;
                Object selected = tree.getLastSelectedPathComponent();
                SemanticSnapshotService.State state = service.getState();
                if (state == null || !(selected instanceof DefaultMutableTreeNode node) || !(node.getUserObject() instanceof Node value) || value.file == null) return;
                VirtualFile file = LocalFileSystem.getInstance().findFileByPath(Path.of(state.repositoryRoot()).resolve(value.file).toString().replace('\\', '/'));
                if (file != null) FileEditorManager.getInstance(project).openTextEditor(new OpenFileDescriptor(project, file), true);
            }
        });
        render();
    }

    private void load(Supplier<String> input) {
        long generation = ++importGeneration;
        Path root;
        try {
            root = Path.of(repositoryRoot.getText()).toAbsolutePath().normalize();
            if (repositoryRoot.getText().isBlank() || !Files.isDirectory(root)) throw new IllegalArgumentException();
        } catch (RuntimeException error) { Messages.showErrorDialog(project, "Choose the local repository root first.", "Change Stack"); return; }
        status.setText("Importing analysis…");
        ProgressManager.getInstance().run(new Task.Backgroundable(project, "Import Change Stack analysis", false) {
            @Override public void run(@NotNull ProgressIndicator indicator) {
                try {
                    ReviewSnapshot snapshot = ReviewSnapshot.parse(input.get());
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (project.isDisposed() || generation != importGeneration) return;
                        service.install(snapshot, root); render();
                    });
                } catch (RuntimeException error) {
                    String message = error instanceof IllegalArgumentException ? error.getMessage() : "Invalid analysis file. Export it with cstack --export-ide.";
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (project.isDisposed() || generation != importGeneration) return;
                        render(); Messages.showErrorDialog(project, message == null ? "Invalid analysis file." : message, "Change Stack");
                    });
                }
            }
        });
    }

    private void render() {
        SemanticSnapshotService.State state = service.getState();
        DefaultMutableTreeNode root = new DefaultMutableTreeNode("Review");
        openReview.setEnabled(state != null && !state.snapshot().demo());
        if (state == null) {
            status.setText("Import analysis to start. No tokens are needed by this plugin.");
            details.setText("Export an analysis with cstack --export-ide, or choose Load sample to test the panel.");
        } else {
            ReviewSnapshot snapshot = state.snapshot();
            repositoryRoot.setText(state.repositoryRoot());
            status.setText((snapshot.demo() ? "Sample · " : "Imported · ") + snapshot.files().size() + " files · " + snapshot.layers().size() + " layers · " + snapshot.source());
            String explanation = snapshot.title() + "\n\n" + snapshot.url() + "\nHead: " + snapshot.headSha() + "\n"
                    + snapshot.sourceBranch() + " → " + snapshot.targetBranch() + "\nExported: " + snapshot.exportedAt() + "\n\n" + snapshot.summary()
                    + (snapshot.warnings().isEmpty() ? "" : "\n\nWarnings:\n" + String.join("\n", snapshot.warnings()));
            DefaultMutableTreeNode overview = new DefaultMutableTreeNode(new Node("Review overview", explanation, null));
            root.add(overview);
            Set<String> grouped = new HashSet<>();
            for (ReviewSnapshot.Group group : snapshot.groups()) {
                DefaultMutableTreeNode branch = new DefaultMutableTreeNode(new Node(group.title(), group.title(), null)); root.add(branch);
                for (ReviewSnapshot.Layer layer : snapshot.layers()) if (group.layers().contains(layer.id())) { branch.add(layerNode(snapshot, layer)); grouped.add(layer.id()); }
            }
            for (ReviewSnapshot.Layer layer : snapshot.layers()) if (!grouped.contains(layer.id())) root.add(layerNode(snapshot, layer));
            details.setText(explanation);
        }
        tree.setModel(new DefaultTreeModel(root));
        for (int i = 0; i < tree.getRowCount(); i++) tree.expandRow(i);
        details.setCaretPosition(0);
    }

    private DefaultMutableTreeNode layerNode(ReviewSnapshot snapshot, ReviewSnapshot.Layer layer) {
        int rank = snapshot.layers().indexOf(layer) + 1;
        StringBuilder explanation = new StringBuilder(layer.title()).append("\n\n").append(layer.summary());
        if (!layer.category().isBlank()) explanation.append("\n\nCategory: ").append(layer.category());
        if (!layer.dependsOn().isEmpty()) {
            explanation.append("\n\nBuilds on:");
            for (ReviewSnapshot.Layer dependency : snapshot.layers()) if (layer.dependsOn().contains(dependency.id())) explanation.append("\n• ").append(dependency.title());
        }
        if (!layer.parts().isEmpty()) {
            explanation.append("\n\nParts:");
            for (ReviewSnapshot.Part part : layer.parts()) explanation.append("\n• ").append(part.title()).append(": ").append(part.summary());
        }
        DefaultMutableTreeNode node = new DefaultMutableTreeNode(new Node(rank + ". " + layer.title(), explanation.toString(), null));
        for (String path : layer.files()) {
            String memberships = String.join("\n", snapshot.layers().stream().filter(candidate -> candidate.files().contains(path)).map(candidate -> "• " + candidate.title()).toList());
            node.add(new DefaultMutableTreeNode(new Node(path, path + "\n\nAppears in:\n" + memberships + "\n\nDouble-click opens your local file. Use the native MR tree to review the committed diff and comment.", path)));
        }
        return node;
    }
}
