/**
 * Thrown when a Clerk Organization has no matching row in our `agencies`
 * table yet — expected transiently right after org creation (Clerk's
 * webhook hasn't landed) or invitation acceptance, and should be rare
 * everywhere else. trpc.ts's errorFormatter surfaces this as
 * `error.data.reason === "AGENCY_SYNC_PENDING"` so the client can
 * distinguish "still syncing, worth a short retry" from a genuine 404.
 */
export class AgencySyncPendingError extends Error {
  constructor(public readonly clerkOrgId: string) {
    super(`No agency synced yet for Clerk organization ${clerkOrgId}`);
    this.name = "AgencySyncPendingError";
  }
}
