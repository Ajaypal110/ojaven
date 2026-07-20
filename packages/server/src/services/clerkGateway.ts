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

  /**
   * Remove a member from the Clerk org. Without this, our soft-delete is
   * cosmetic: the member keeps passing agencyProcedure (org claim intact)
   * and keeps full product access.
   */
  removeOrganizationMember(params: { clerkOrgId: string; clerkUserId: string }): Promise<void>;

  /**
   * One Clerk user's identity fields, or null if Clerk has no such user
   * (deleted account). Used by user provisioning to fetch email/name for
   * the row it creates.
   */
  getUser(clerkUserId: string): Promise<{
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
  } | null>;

  /**
   * The Clerk user ids that currently own a given email address (lowercased
   * match). Empty when no live Clerk account holds it. This is how
   * provisioning decides an email conflict is safe to reclaim: if OUR
   * stored id for that email is NOT in Clerk's live set, the stored row is
   * an orphan (its Clerk account was deleted) and can be tombstoned;
   * if it IS still live, the email genuinely belongs to another active
   * account and reclaim is refused.
   */
  getUserIdsForEmail(email: string): Promise<string[]>;
}
