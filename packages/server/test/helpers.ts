import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { agencies, db, users } from "@ojaven/db";
import type { ClerkGateway } from "../src/services/clerkGateway";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Test rows are isolated the same way real tenants are: every query in
 * the system is agency-scoped, so a throwaway agency with a unique
 * clerkOrgId can't interact with real dev data. Deleting the agency
 * cascades team_members / invitations / notifications; users are tracked
 * and deleted separately.
 */
export async function seedAgency(name = "Test Agency") {
  const [agency] = await db
    .insert(agencies)
    .values({ clerkOrgId: `org_test_${randomUUID()}`, name })
    .returning();
  if (!agency) throw new Error("seedAgency failed");
  return agency;
}

export async function seedUser(label = "user") {
  const id = `user_test_${randomUUID()}`;
  const [user] = await db
    .insert(users)
    .values({
      id,
      email: `${label}-${randomUUID()}@test.ojaven.local`,
      firstName: label,
      lastName: "Test",
    })
    .returning();
  if (!user) throw new Error("seedUser failed");
  return user;
}

export async function cleanupAgencies(ids: string[]) {
  if (ids.length === 0) return;
  await db.delete(agencies).where(inArray(agencies.id, ids));
}

export async function cleanupUsers(ids: string[]) {
  if (ids.length === 0) return;
  await db.delete(users).where(inArray(users.id, ids));
}

export async function getAgencyRecoveryState(agencyId: string) {
  const [row] = await db
    .select({
      requestedAt: agencies.ownershipRecoveryRequestedAt,
      requestedById: agencies.ownershipRecoveryRequestedById,
    })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  return row;
}

/** Backdate a pending recovery request so the grace period has "elapsed". */
export async function backdateRecoveryRequest(agencyId: string, toEpochMs: number) {
  await db
    .update(agencies)
    .set({ ownershipRecoveryRequestedAt: new Date(toEpochMs) })
    .where(eq(agencies.id, agencyId));
}

/**
 * Stub ClerkGateway: lastSignInAt per userId comes straight from the map
 * you pass (absent keys behave like deleted Clerk accounts — no evidence).
 * Invitation creation returns a fake id and records the call.
 */
export function stubGateway(lastSignIns: Record<string, number | null> = {}) {
  const sentInvitations: Array<{ email: string; clerkRole: string }> = [];
  const removedMembers: Array<{ clerkOrgId: string; clerkUserId: string }> = [];
  const gateway: ClerkGateway = {
    async getUserLastSignInAt(userIds) {
      const result = new Map<string, number | null>();
      for (const id of userIds) {
        if (id in lastSignIns) result.set(id, lastSignIns[id] ?? null);
      }
      return result;
    },
    async createOrganizationInvitation({ email, clerkRole }) {
      sentInvitations.push({ email, clerkRole });
      return `orginv_test_${randomUUID()}`;
    },
    async removeOrganizationMember({ clerkOrgId, clerkUserId }) {
      removedMembers.push({ clerkOrgId, clerkUserId });
    },
  };
  return { gateway, sentInvitations, removedMembers };
}
