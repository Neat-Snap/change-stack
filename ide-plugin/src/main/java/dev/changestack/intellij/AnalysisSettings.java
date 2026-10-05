package dev.changestack.intellij;

import com.google.gson.JsonObject;
import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.Credentials;
import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.openapi.components.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.ui.components.*;
import org.jetbrains.annotations.NotNull;
import javax.swing.*;
import java.awt.GridLayout;
import java.net.URI;

@Service(Service.Level.APP)
@State(name = "ChangeStackModel", storages = @Storage("change-stack-model.xml"))
public final class AnalysisSettings implements PersistentStateComponent<AnalysisSettings.Model> {
    public static final class Model {
        public String endpoint = "", model = "", language = "en", caFile = "";
        public boolean useNessyCertificate = true;
    }
    private Model state = new Model();
    private volatile String sessionKey;
    private static CredentialAttributes attributes() { return new CredentialAttributes("Change Stack analysis model", "model"); }
    @Override public Model getState() { return state; }
    @Override public void loadState(@NotNull Model value) { state = value; }
    static AnalysisSettings get() { return com.intellij.openapi.application.ApplicationManager.getApplication().getService(AnalysisSettings.class); }
    JsonObject model() {
        if (state.endpoint.isBlank() || state.model.isBlank()) return null;
        String key = sessionKey == null ? PasswordSafe.getInstance().getPassword(attributes()) : sessionKey;
        if (key == null || key.isBlank()) return null;
        JsonObject result = new JsonObject(); result.addProperty("baseUrl", state.endpoint); result.addProperty("model", state.model);
        result.addProperty("apiKey", key); result.addProperty("language", state.language); return result;
    }
    boolean configure(Project project) { return new ModelDialog(project).showAndGet(); }
    private final class ModelDialog extends DialogWrapper {
        private final Project project;
        final JBTextField endpoint = new JBTextField(state.endpoint), model = new JBTextField(state.model);
        final JPasswordField key = new JPasswordField();
        final JComboBox<String> language = new JComboBox<>(new String[]{"en", "ru"});
        final JBTextField caFile = new JBTextField(state.caFile);
        final JCheckBox nessy = new JCheckBox("Use ~/.nessy/certs/tinkoff-bundle.crt automatically when present", state.useNessyCertificate);
        ModelDialog(Project project) { super(project); this.project = project; setTitle("Change Stack Analysis Settings"); language.setSelectedItem(state.language); init(); }
        @Override protected JComponent createCenterPanel() {
            JPanel panel = new JPanel(new GridLayout(0, 1, 4, 4));
            panel.add(new JBLabel("OpenAI-compatible API base URL (include /v1 when needed)")); panel.add(endpoint);
            panel.add(new JBLabel("Model ID")); panel.add(model); panel.add(new JBLabel("API key (blank keeps the saved key)")); panel.add(key);
            panel.add(new JBLabel("Explanation language")); panel.add(language);
            panel.add(new JBLabel("Corporate CA bundle (.crt / .pem; blank uses automatic detection)"));
            JPanel certificate = new JPanel(new java.awt.BorderLayout(4, 0));
            JButton browse = new JButton("Browse…");
            browse.addActionListener(event -> {
                var descriptor = new com.intellij.openapi.fileChooser.FileChooserDescriptor(true, false, false, false, false, false);
                var file = com.intellij.openapi.fileChooser.FileChooser.chooseFile(descriptor, project, null);
                if (file != null) caFile.setText(file.getPath());
            });
            certificate.add(caFile); certificate.add(browse, java.awt.BorderLayout.EAST); panel.add(certificate); panel.add(nessy);
            panel.add(new JBLabel("Certificate validation stays enabled. The bundle is read only when analysis starts."));
            panel.add(new JBLabel("The selected MR's changes go to this endpoint. GitLab login stays in IDEA."));
            panel.setPreferredSize(new java.awt.Dimension(640, 390)); return panel;
        }
        @Override protected void doOKAction() {
            try {
                URI uri = URI.create(endpoint.getText().trim());
                if (!java.util.Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || model.getText().isBlank()) throw new IllegalArgumentException();
                String secret = new String(key.getPassword());
                if (secret.isBlank() && state.endpoint.isBlank()) { setErrorText("Enter the model API key."); return; }
                if (!secret.isBlank()) {
                    sessionKey = secret;
                    com.intellij.openapi.application.ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        try { PasswordSafe.getInstance().set(attributes(), new Credentials("model", secret)); }
                        catch (RuntimeException error) {
                            com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater(() ->
                                    com.intellij.openapi.ui.Messages.showWarningDialog("The model key is available for this session, but IDEA's Password Safe could not save it.", "Change Stack"));
                        }
                    });
                }
                state.endpoint = endpoint.getText().trim(); state.model = model.getText().trim(); state.language = (String) language.getSelectedItem();
                state.caFile = caFile.getText().trim(); state.useNessyCertificate = nessy.isSelected();
                super.doOKAction();
            } catch (RuntimeException error) { setErrorText("Enter a valid HTTP(S) endpoint and model ID."); }
        }
    }
}
