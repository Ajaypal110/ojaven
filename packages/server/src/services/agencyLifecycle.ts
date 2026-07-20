import { and, eq, isNull } from "drizzle-orm";
import { agencies, db } from "@ojaven/db";

/**
 * Soft-delete an agency by its Clerk org id — the organization.deleted
 * webhook handler. Idempotent: an already-deleted (or unknown) org matches
 * nothing. Deliberately soft: cascading a hard delete on a webhook would
 * destroy all the agency's clients/deals/billing irreversibly on a single
 * Clerk-side action; soft-delete keeps the data recoverable and consistent
 * with how every other deletion in the system behaves.
 */
export async function softDeleteAgencyByClerkOrgId(clerkOrgId: string) {
  const [deleted] = await db
    .update(agencies)
    .set({ deletedAt: new Date() })
    .where(and(eq(agencies.clerkOrgId, clerkOrgId), isNull(agencies.deletedAt)))
    .returning({ id: agencies.id });
  return deleted ?? null;
}
