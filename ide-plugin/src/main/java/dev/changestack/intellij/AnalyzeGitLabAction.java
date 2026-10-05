package dev.changestack.intellij;

import com.google.gson.JsonObject;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.progress.*;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vcs.changes.ui.ChangesTree;
import org.jetbrains.annotations.NotNull;
import java.util.ArrayList;
import java.util.Set;

public final class AnalyzeGitLabAction extends DumbAwareAction {
    @Override public void update(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        boolean context = project != null && NativeGitLabBridge.reviewUrl(event.getDataContext()) != null;
        event.getPresentation().setVisible(context);
        event.getPresentation().setEnabled(context && !project.getService(SemanticSnapshotService.class).isRunning());
    }
    @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject(); if (project == null) return;
        start(project, event.getDataContext());
    }
    static void start(Project project, DataContext dataContext) {
        NativeGitLabBridge.Context context;
        NativeGitLabBridge.Account account;
        try {
            context = NativeGitLabBridge.capture(project, dataContext);
            var accounts = NativeGitLabBridge.accounts(context.url());
            if (accounts.isEmpty()) throw new IllegalArgumentException("Sign in to this GitLab server in IDEA's Version Control → GitLab settings first.");
            if (accounts.size() == 1) account = accounts.getFirst();
            else {
                AccountDialog dialog = new AccountDialog(project, accounts);
                if (!dialog.showAndGet()) return;
                account = (NativeGitLabBridge.Account) dialog.accounts.getSelectedItem();
            }
        } catch (IllegalArgumentException error) { Messages.showErrorDialog(project, error.getMessage(), "Change Stack"); return; }
        AnalysisSettings settings = AnalysisSettings.get();
        if (settings.getState().endpoint.isBlank() && !settings.configure(project)) return;
        SemanticSnapshotService service = project.getService(SemanticSnapshotService.class);
        if (!service.beginAnalysis(context.url())) return;
        long generation = service.generation();
        ProgressManager.getInstance().run(new Task.Backgroundable(project, "Analyzing GitLab MR with Change Stack", true) {
            private ReviewSnapshot snapshot;
            private String failure;
            @Override public void run(@NotNull ProgressIndicator indicator) {
                service.bindIndicator(indicator);
                JsonObject host = new JsonObject(), request = new JsonObject();
                JsonObject model = null;
                try {
                    indicator.checkCanceled(); indicator.setIndeterminate(true);
                    indicator.setText("Using IDEA's GitLab account");
                    host.addProperty("provider", "gitlab"); host.addProperty("baseUrl", account.baseUrl());
                    host.addProperty("token", NativeGitLabBridge.token(account, indicator));
                    request.addProperty("version", 1); request.addProperty("url", context.url());
                    request.addProperty("expectedHeadSha", context.headSha()); request.add("host", host);
                    service.reportProgress("Loading analysis model credentials");
                    model = settings.model();
                    if (model == null) throw new IllegalArgumentException("Configure the model API key with Change Stack → Analysis model settings in GitLab's MR menu.");
                    request.add("ai", model);
                    snapshot = AnalyzerProcess.analyze(request, indicator, settings.getState(), service::reportProgress);
                    indicator.checkCanceled();
                } catch (ProcessCanceledException canceled) { throw canceled; }
                catch (Exception error) {
                    failure = error instanceof IllegalArgumentException ? error.getMessage()
                            : "Could not analyze this MR. Check GitLab login, model settings, and connectivity.";
                } finally { host.remove("token"); request.remove("host"); if (model != null) model.remove("apiKey"); }
            }
            @Override public void onSuccess() {
                if (project.isDisposed()) { service.finishAnalysis("Analysis stopped"); return; }
                if (failure != null) {
                    service.finishAnalysis("Analysis failed · " + failure);
                    Messages.showErrorDialog(project, failure, "Change Stack"); return;
                }
                if (generation != service.generation() || !stillCurrent(context)) {
                    service.finishAnalysis("Review changed · analyze the current MR again");
                    Messages.showWarningDialog(project, "GitLab's loaded changes changed during analysis. Analyze the current MR again.", "Change Stack"); return;
                }
                service.reportProgress("Applying semantic groups to GitLab's file tree");
                try {
                    service.installNative(snapshot, context); service.rememberGrouping(context.tree()); enableGrouping(context.tree());
                    service.finishAnalysis(snapshot.source().equals("local")
                            ? "Model unavailable · local grouping only · see the inline analysis notes"
                            : "Analysis complete · " + snapshot.layers().size() + " layers" + (snapshot.warnings().isEmpty() ? "" : " · " + snapshot.warnings().size() + " warnings"));
                } catch (RuntimeException error) {
                    service.finishAnalysis("Could not display semantic review · native GitLab review remains available");
                    Messages.showErrorDialog(project, "Could not display this analysis. Check idea.log for the Change Stack exception.", "Change Stack");
                    com.intellij.openapi.diagnostic.Logger.getInstance(AnalyzeGitLabAction.class).warn("Could not display semantic review", error);
                }
            }
            @Override public void onCancel() { service.finishAnalysis("Analysis cancelled"); }
            @Override public void onThrowable(@NotNull Throwable error) {
                service.finishAnalysis("Analysis stopped unexpectedly · check idea.log");
                com.intellij.openapi.diagnostic.Logger.getInstance(AnalyzeGitLabAction.class).warn("Analysis task stopped", error);
            }
        });
    }
    static void enableGrouping(ChangesTree tree) {
        for (String key : new ArrayList<>(tree.getGroupingSupport().getGroupingKeys())) tree.getGroupingSupport().set(key, false);
        tree.getGroupingSupport().set("cstack.semantic", true);
        tree.rebuildTree(); tree.expandAll();
    }
    private static final class AccountDialog extends com.intellij.openapi.ui.DialogWrapper {
        final javax.swing.JComboBox<NativeGitLabBridge.Account> accounts;
        AccountDialog(Project project, java.util.List<NativeGitLabBridge.Account> values) {
            super(project); accounts = new javax.swing.JComboBox<>(values.toArray(NativeGitLabBridge.Account[]::new));
            setTitle("GitLab Account for Analysis"); init();
        }
        @Override protected javax.swing.JComponent createCenterPanel() { return accounts; }
    }
    static boolean stillCurrent(NativeGitLabBridge.Context context) {
        if (!context.tree().isDisplayable()) return false;
        var nodes = context.tree().getRoot().depthFirstEnumeration();
        Set<Object> current = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        while (nodes.hasMoreElements()) {
            Object value = ((javax.swing.tree.DefaultMutableTreeNode) nodes.nextElement()).getUserObject();
            if (NativeGitLabBridge.isChange(value)) current.add(value);
        }
        return current.size() == context.changes().size() && current.containsAll(context.changes());
    }
}
