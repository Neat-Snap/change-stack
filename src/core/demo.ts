import { makePatch, countChanges } from './providers';
import { localAnalysis } from './analysis';
import type { ChangedFile, Session } from './types';

export function demoSession(): Session {
  const changes = [
    ['src/invitations/service.ts', '@@ -1,5 +1,9 @@\n export async function acceptInvitation(token: string) {\n   const invitation = await invitations.findByToken(token);\n+  if (!invitation || invitation.expiresAt < new Date()) {\n+    throw new Error("Invitation is expired or invalid");\n+  }\n   await members.add(invitation.email, invitation.organizationId);\n+  await invitations.markAccepted(invitation.id);\n   return invitation.organizationId;\n }\n'],
    ['src/invitations/routes.ts', '@@ -1,4 +1,5 @@\n router.post("/invitations/accept", async (request) => {\n   const { token } = await request.json();\n+  if (typeof token !== "string") return new Response("Invalid token", { status: 400 });\n   return Response.json(await acceptInvitation(token));\n });\n'],
    ['src/components/InviteForm.tsx', '@@ -1,5 +1,7 @@\n export function InviteForm() {\n   const [email, setEmail] = useState("");\n+  const [error, setError] = useState<string | null>(null);\n   return <form onSubmit={sendInvitation}>\n     <input value={email} onChange={e => setEmail(e.target.value)} />\n+    {error && <p role="alert">{error}</p>}\n   </form>;\n'],
    ['tests/invitations.test.ts', '@@ -0,0 +1,5 @@\n+test("expired invitations cannot add members", async () => {\n+  const invitation = await createInvitation({ expiresAt: yesterday });\n+  await expect(acceptInvitation(invitation.token)).rejects.toThrow("expired");\n+  expect(await members.find(invitation.email)).toBeNull();\n+});\n'],
  ];
  const files: ChangedFile[] = changes.map(([path, diff], i) => ({ path: path!, oldPath: path!, status: i === 3 ? 'added' : 'modified',
    patch: makePatch(path!, path!, i === 3 ? 'added' : 'modified', diff!), ...countChanges(diff!), incomplete: false }));
  const review = { target: { provider: 'gitlab' as const, origin: 'https://gitlab.example.internal', project: 'platform/workspace', number: 142,
    url: 'https://gitlab.example.internal/platform/workspace/-/merge_requests/142' }, title: 'Make teammate invitations safer to accept',
    description: 'Reject expired invitation tokens, validate requests at the API boundary, and surface errors in the invitation form.',
    author: 'alex', sourceBranch: 'fix/invitation-expiry', targetBranch: 'main', headSha: 'c5e3a1498fbb', files, warnings: [] };
  return { review, aiEnabled: false, demo: true, analysis: { ...localAnalysis(review), layers: [
    { id: 'demo-api', title: 'Invitation acceptance', summary: 'Adds expiry validation before creating a member and marks the invitation as accepted. The route also rejects non-string tokens.', files: files.slice(0, 2).map(f => f.path), questions: ['Could two concurrent requests accept the same invitation?', 'Does membership creation and marking acceptance happen atomically?'] },
    { id: 'demo-ui', title: 'Feedback in the invitation form', summary: 'Adds error state and an accessible alert.\n\n- Keep the entered email after a failed request.\n- Check how `sendInvitation` fills the error state; its code is outside this patch.', files: [files[2]!.path], questions: ['Is the entered email preserved after a failed request?'] },
    { id: 'demo-tests', title: 'Expiry regression coverage', summary: 'Adds a test asserting an expired invitation cannot create a member.', files: [files[3]!.path], questions: ['Is an invitation expiring exactly now covered?'] },
  ] } };
}
