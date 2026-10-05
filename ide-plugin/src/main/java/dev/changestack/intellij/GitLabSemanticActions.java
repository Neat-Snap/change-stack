package dev.changestack.intellij;

import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vcs.changes.ui.ChangesTree;
import org.jetbrains.annotations.NotNull;

public final class GitLabSemanticActions {
    public static final class Settings extends DumbAwareAction {
        @Override public void actionPerformed(@NotNull AnActionEvent event) { if (event.getProject() != null) AnalysisSettings.get().configure(event.getProject()); }
    }
    public static final class Clear extends DumbAwareAction {
        @Override public void actionPerformed(@NotNull AnActionEvent event) {
            Project project = event.getProject(); if (project == null) return;
            project.getService(SemanticSnapshotService.class).clear();
            var window = com.intellij.openapi.wm.ToolWindowManager.getInstance(project).getToolWindow("Merge Requests");
            if (window != null) for (var content : window.getContentManager().getContents()) refresh(content.getComponent());
        }
        private void refresh(java.awt.Component component) {
            if (component instanceof ChangesTree tree) { tree.getGroupingSupport().set("cstack.semantic", false); tree.rebuildTree(); }
            if (component instanceof java.awt.Container container) for (var child : container.getComponents()) refresh(child);
        }
    }
}
