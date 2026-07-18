/**
 * The one seam where team/ownership logic touches Clerk. Exists so the
 * services can be integration-tested against a real database with only
 * this stubbed — `lastSignInAt` is the single fact we cannot fabricate
 * against a real Clerk instance (you can't make a real account 30 days
 * inactive on demand), and invitation-sending shouldn't fire real emails
 * from tests.
 *
 * Interface-only file, deliberately: the live implementation lives in
 * liveClerkGateway.ts because importing @clerk/nextjs/server crashes at
 * module load outside a Next.js runtime (its internal imports don't
 * resolve under plain Node) — tests import this file, never that one.
 * Keep this interface narrow; it is not a general Clerk wrapper.
 */
export interface ClerkGateway {
  /**
   * Map of userId -> lastSignInAt epoch ms, or null if the user has never
   * signed in. A userId absent from the map (e.g. deleted Clerk account)
   * means "no sign-in evidence" — callers treat absence as inactive.
   */
  getUserLastSignInAt(userIds: string[]): Promise<Map<string, number | null>>;

  /** Create a Clerk org invitation (sends the actual email). Returns Clerk's invitation id. */
  createOrganizationInvitation(params: {
    clerkOrgId: string;
    inviterUserId: string;
    email: string;
    clerkRole: "org:admin" | "org:member";
  }): Promise<string>;
}
