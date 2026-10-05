package demo;

public class InvitationServiceTest {
    public static void main(String[] args) {
        InvitationService service = new InvitationService();
        assert service.accept(200, 100);
        assert !service.accept(100, 200);
    }
}
