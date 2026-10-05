package dev.changestack.intellij;

import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import static org.junit.Assert.*;

public class ReviewSnapshotTest {
    public static final class WrappedCredential { public String getAccessToken() { return "fixture-token"; } }
    @Test public void readsBothGitLabCredentialRepresentationsAndRejectsMissingCredentials() {
        assertEquals("fixture-token", NativeGitLabBridge.credentialToken("fixture-token"));
        assertEquals("fixture-token", NativeGitLabBridge.credentialToken(new WrappedCredential()));
        assertThrows(IllegalArgumentException.class, () -> NativeGitLabBridge.credentialToken(null));
        assertThrows(IllegalArgumentException.class, () -> NativeGitLabBridge.credentialToken(""));
    }
    private String sample() throws Exception {
        try (var input = getClass().getResourceAsStream("/sample-analysis.json")) {
            assertNotNull(input); return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
    @Test public void retainsRepeatedMembershipsWhileGroupingEachFileOnce() throws Exception {
        ReviewSnapshot snapshot = ReviewSnapshot.parse(sample());
        assertEquals(3, snapshot.layers().size());
        assertTrue(snapshot.layers().get(1).files().contains("src/main/java/demo/InvitationService.java"));
        Map<String, ReviewSnapshot.LayerKey> groups = snapshot.primaryLayers();
        assertEquals(3, groups.size());
        assertEquals("service", groups.get("src/main/java/demo/InvitationService.java").id());
        assertTrue(groups.get("src/main/java/demo/InvitationService.java").label().startsWith("01 · Reject expired tokens"));
        assertEquals(2, groups.get("src/test/java/demo/InvitationServiceTest.java").rank());
    }
    @Test public void rejectsPathTraversalAndCredentialBearingReviewUrls() throws Exception {
        String text = sample();
        assertThrows(IllegalArgumentException.class, () -> ReviewSnapshot.parse(text.replace("src/main/java/demo/InvitationService.java", "../secret")));
        assertThrows(IllegalArgumentException.class, () -> ReviewSnapshot.parse(text.replace("https://gitlab.example", "https://token@gitlab.example")));
        assertThrows(IllegalArgumentException.class, () -> ReviewSnapshot.parse(text.replace("https://gitlab.example", "javascript:gitlab.example")));
    }
    @Test public void rejectsUnknownFilesAndUnsupportedVersions() throws Exception {
        String text = sample();
        assertThrows(IllegalArgumentException.class, () -> ReviewSnapshot.parse(text.replace("\"version\": 1", "\"version\": 2")));
        assertThrows(IllegalArgumentException.class, () -> ReviewSnapshot.parse(text.replace("\"category\": \"Backend fix\", \"files\": [\"src/main/java/demo/InvitationService.java\"]", "\"category\": \"Backend fix\", \"files\": [\"missing.java\"]")));
    }
    @Test public void projectSnapshotsUseExactRepositoryPathsAndClearCleanly() throws Exception {
        SemanticSnapshotService service = new SemanticSnapshotService();
        service.install(ReviewSnapshot.parse(sample()), Path.of("/tmp/repo"));
        assertTrue(service.getState().pathToLayer().containsKey("/tmp/repo/src/main/java/demo/InvitationService.java"));
        assertFalse(service.getState().pathToLayer().containsKey("/tmp/another/src/main/java/demo/InvitationService.java"));
        service.clear(); assertNull(service.getState());
    }
}
