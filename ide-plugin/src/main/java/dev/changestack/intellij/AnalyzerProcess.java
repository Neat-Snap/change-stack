package dev.changestack.intellij;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.application.PathManager;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.concurrent.*;
import java.util.function.Consumer;

final class AnalyzerProcess {
    static Path executable() throws IOException {
        String os = System.getProperty("os.name").toLowerCase(), architecture = System.getProperty("os.arch");
        String target = os.contains("mac") ? (architecture.equals("aarch64") || architecture.equals("arm64") ? "macos-arm64" : "macos-x64")
                : os.contains("linux") && architecture.equals("amd64") ? "linux-x64" : null;
        if (target == null) throw new IllegalArgumentException("This preview includes analyzers for macOS and Linux x64.");
        if (!(AnalyzerProcess.class.getClassLoader() instanceof com.intellij.ide.plugins.cl.PluginAwareClassLoader loader))
            throw new IllegalArgumentException("The Change Stack plugin installation is unavailable. Restart IDEA after installing the ZIP.");
        var plugin = loader.getPluginDescriptor();
        Path directory = Path.of(PathManager.getSystemPath(), "change-stack", plugin.getVersion(), target);
        Path file = directory.resolve("cstack");
        synchronized (AnalyzerProcess.class) {
            if (Files.isRegularFile(file) && Files.size(file) > 0) return file;
            Files.createDirectories(directory);
            Path payload = plugin.getPluginPath().resolve("analyzers").resolve(target).resolve("cstack");
            if (!Files.isRegularFile(payload)) throw new IllegalArgumentException("The analyzer is missing from this plugin ZIP. Install the complete GitLab addon build.");
            try (InputStream input = Files.newInputStream(payload)) {
                Path temporary = Files.createTempFile(directory, "cstack-", ".tmp");
                try { Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING); Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rwx------")); Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING); }
                finally { Files.deleteIfExists(temporary); }
            }
        }
        return file;
    }
    static Path certificate(String configured, boolean useNessy, String environment, Path home) throws IOException {
        String value = configured.isBlank() ? environment : configured;
        Path path;
        if (value != null && !value.isBlank()) {
            path = value.startsWith("~/") ? home.resolve(value.substring(2)) : Path.of(value);
            if (!path.isAbsolute()) throw new IllegalArgumentException("Choose an absolute corporate CA bundle path in Analysis settings.");
        } else {
            path = home.resolve(".nessy/certs/tinkoff-bundle.crt");
            if (!useNessy || !Files.isRegularFile(path)) return null;
        }
        if (!Files.isRegularFile(path) || !Files.isReadable(path)) throw new IllegalArgumentException("The corporate CA bundle is unavailable. Choose a readable .crt or .pem file in Analysis settings.");
        if (Files.size(path) > 2_000_000 || !Files.readString(path).contains("-----BEGIN CERTIFICATE-----"))
            throw new IllegalArgumentException("The corporate CA bundle must be a PEM certificate file under 2 MB. Update Analysis settings.");
        return path.toAbsolutePath().normalize();
    }
    static ReviewSnapshot analyze(JsonObject request, ProgressIndicator indicator, AnalysisSettings.Model settings, Consumer<String> report) throws Exception {
        indicator.setIndeterminate(true);
        report.accept("Checking corporate certificates");
        Path certificate = certificate(settings.caFile, settings.useNessyCertificate, System.getenv("CHANGE_STACK_CA_FILE"), Path.of(System.getProperty("user.home")));
        indicator.checkCanceled();
        report.accept("Preparing bundled analyzer" + (certificate == null ? "" : " · corporate CA bundle loaded"));
        ProcessBuilder builder = new ProcessBuilder(executable().toString(), "--ide-request");
        if (certificate != null) builder.environment().put("CHANGE_STACK_CA_FILE", certificate.toString());
        indicator.checkCanceled();
        Process process = builder.start();
        ExecutorService readers = Executors.newFixedThreadPool(2);
        try {
            Future<String> output = readers.submit(() -> boundedOutput(process.getInputStream()));
            Future<?> progress = readers.submit(() -> {
                try (BufferedReader input = process.errorReader(StandardCharsets.UTF_8)) {
                    String line;
                    while ((line = input.readLine()) != null) {
                        if (line.length() > 4096) continue;
                        try { JsonObject event = JsonParser.parseString(line).getAsJsonObject(); if (event.has("progress")) {
                            String message = event.get("progress").getAsString(); indicator.setText2(message); report.accept(message);
                        } }
                        catch (RuntimeException ignored) { /* Never forward arbitrary process output or credentials. */ }
                    }
                } catch (IOException ignored) { }
            });
            try (var input = process.outputWriter(StandardCharsets.UTF_8)) { input.write(request.toString()); }
            long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(30);
            while (!process.waitFor(100, TimeUnit.MILLISECONDS)) { indicator.checkCanceled(); if (System.nanoTime() > deadline) throw new IllegalArgumentException("Analysis timed out. Try a smaller MR or a faster model."); }
            indicator.checkCanceled();
            JsonObject result = JsonParser.parseString(output.get(10, TimeUnit.SECONDS)).getAsJsonObject();
            progress.get(10, TimeUnit.SECONDS);
            if (!result.has("ok") || !result.get("ok").getAsBoolean()) throw new IllegalArgumentException(result.has("error") ? result.get("error").getAsString() : "Analysis failed.");
            return ReviewSnapshot.parse(result.get("snapshot").toString());
        } finally { process.destroyForcibly(); readers.shutdownNow(); }
    }
    private static String boundedOutput(InputStream input) throws IOException {
        try (input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > 16 * 1024 * 1024) throw new IOException("Analysis output is too large."); output.write(buffer, 0, count); }
            return output.toString(StandardCharsets.UTF_8);
        }
    }
}
