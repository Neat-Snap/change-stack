package dev.changestack.intellij;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.Assert.*;

public class AnalyzerCertificateTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private Path bundle(Path path) throws Exception {
        Files.createDirectories(path.getParent());
        return Files.writeString(path, "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n");
    }
    @Test public void autoDetectsNessyWithoutCopyingOrRequiringIdeEnvironment() throws Exception {
        Path home = temporary.newFolder("home").toPath();
        Path nessy = bundle(home.resolve(".nessy/certs/tinkoff-bundle.crt"));
        assertEquals(nessy, AnalyzerProcess.certificate("", true, null, home));
        assertNull(AnalyzerProcess.certificate("", false, null, home));
        assertNull(AnalyzerProcess.certificate("", true, null, temporary.newFolder("empty").toPath()));
    }
    @Test public void explicitBundleOverridesEnvironmentAndAutomaticDetectionAndExpandsHome() throws Exception {
        Path home = temporary.newFolder("home").toPath();
        Path explicit = bundle(home.resolve("company.crt"));
        Path environment = bundle(home.resolve("environment.pem"));
        bundle(home.resolve(".nessy/certs/tinkoff-bundle.crt"));
        assertEquals(explicit, AnalyzerProcess.certificate("~/company.crt", true, environment.toString(), home));
        assertEquals(environment, AnalyzerProcess.certificate("", true, environment.toString(), home));
    }
    @Test public void invalidExplicitBundlesFailInsteadOfSilentlyUsingAnotherCertificate() throws Exception {
        Path home = temporary.newFolder("home").toPath();
        bundle(home.resolve(".nessy/certs/tinkoff-bundle.crt"));
        for (String path : new String[]{home.resolve("missing.pem").toString(), "relative.pem",
                Files.writeString(home.resolve("bad.pem"), "not a certificate").toString(),
                Files.writeString(home.resolve("huge.pem"), "-----BEGIN CERTIFICATE-----" + "x".repeat(2_000_000)).toString()}) {
            assertThrows(IllegalArgumentException.class, () -> AnalyzerProcess.certificate(path, true, null, home));
        }
    }
}
