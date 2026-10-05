package demo;

public class InvitationController {
    private final InvitationService service = new InvitationService();

    public String accept(long expiresAt) {
        return service.accept(expiresAt, System.currentTimeMillis()) ? "accepted" : "expired";
    }
}
