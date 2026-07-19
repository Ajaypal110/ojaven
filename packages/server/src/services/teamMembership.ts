import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, invitations, teamMembers, users, teamMemberRoleEnum } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { ClerkGateway } from "./clerkGateway";

export type TeamMemberRole = (typeof teamMemberRoleEnum.enumValues)[number];

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Serializes all membership/ownership mutations per agency. This replaces
 * the race-safety the old one-owner partial unique index provided for
 * free: without it, two concurrent first-joins of a brand-new agency could
 * both see "zero members" and both insert themselves as owner. Advisory
 * xact locks release automatically at commit/rollback. hashtext collisions
 * across agencies just serialize two unrelated agencies briefly — harmless.
 */
async function lockAgency(tx: Tx, agencyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`);
}

async function activeMemberByUser(tx: Tx, agencyId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, agencyId),
        eq(teamMembers.userId, userId),
        isNull(teamMembers.deletedAt)
      )
    )
    .limit(1);
  return row;
}

async function activeMemberById(tx: Tx, agencyId: string, memberId: string) {
  const [row] = await tx
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, agencyId),
        eq(teamMembers.id, memberId),
        isNull(teamMembers.deletedAt)
      )
    )
    .limit(1);
  return row;
}

export async function activeOwners(tx: Tx, agencyId: string) {
  return tx
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, agencyId),
        eq(teamMembers.role, "owner"),
        isNull(teamMembers.deletedAt)
      )
    );
}

function requireOwnerActor(actor: { role: TeamMemberRole } | undefined): asserts actor is {
  role: "owner";
} & Record<string, unknown> {
  if (!actor || actor.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner can do this." });
  }
}

/**
 * Role resolution order (moved verbatim from the webhook handler, now the
 * single source of truth for both entry points):
 * 1. Pending invitation (agencyId + email) — the only place manager/
 *    operator ever comes from; marks it accepted.
 * 2. No active members yet -> first member -> owner.
 * 3. Fallback: map Clerk's binary role (org:admin -> admin, else operator)
 *    — someone added via Clerk's dashboard, bypassing our invite flow.
 */
async function resolveRole(
  tx: Tx,
  params: { agencyId: string; userId: string; clerkOrgRole?: string | null }
): Promise<TeamMemberRole> {
  const [user] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (user) {
    const [invitation] = await tx
      .select({ id: invitations.id, role: invitations.role })
      .from(invitations)
      .where(
        and(
          eq(invitations.agencyId, params.agencyId),
          eq(invitations.email, user.email),
          eq(invitations.status, "pending")
        )
      )
      .limit(1);

    if (invitation) {
      await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      return invitation.role;
    }
  }

  const [anyMember] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.agencyId, params.agencyId), isNull(teamMembers.deletedAt)))
    .limit(1);

  if (!anyMember) return "owner";

  return params.clerkOrgRole === "org:admin" ? "admin" : "operator";
}

/**
 * Idempotent membership bootstrap — the shared function both the Clerk
 * webhook and team.ensureMembership call. Safe to call redundantly (from
 * onboarding, the (product) layout effect, and webhook delivery all at
 * once): an existing active membership short-circuits, and the advisory
 * lock serializes concurrent first-joins so exactly one owner can result.
 */
export async function ensureMembership(params: {
  agencyId: string;
  userId: string;
  clerkOrgRole?: string | null;
  clerkMembershipId?: string | null;
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const [existing] = await tx
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.agencyId, params.agencyId), eq(teamMembers.userId, params.userId)))
      .limit(1);

    if (existing && !existing.deletedAt) {
      return { member: existing, created: false };
    }

    if (existing) {
      // Soft-deleted row = deliberately removed. Revival requires EVIDENCE
      // of a genuine re-join, not just presence in the Clerk org — the
      // layout effect fires for anyone with an org claim, and without this
      // gate a removed member's next page load would silently un-remove
      // them. Two acceptable proofs:
      //  1. A pending invitation (agencyId + email): re-invited through
      //     our flow.
      //  2. A clerkMembershipId DIFFERENT from the stored one: Clerk
      //     itself re-admitted them (fresh membership, e.g. re-added via
      //     Clerk's dashboard). Same-id means a webhook redelivery of the
      //     stale membership.created from BEFORE the removal — refused,
      //     so out-of-order delivery can't resurrect a removed member.
      // The layout-effect path passes no clerkMembershipId and a removed
      // member has no pending invitation, so it can never revive.
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1);

      const [pendingInvitation] = user
        ? await tx
            .select({ id: invitations.id })
            .from(invitations)
            .where(
              and(
                eq(invitations.agencyId, params.agencyId),
                eq(invitations.email, user.email),
                eq(invitations.status, "pending")
              )
            )
            .limit(1)
        : [undefined];

      const freshClerkMembership =
        params.clerkMembershipId != null &&
        params.clerkMembershipId !== existing.clerkMembershipId;

      if (!pendingInvitation && !freshClerkMembership) {
        return { member: null, created: false, revivalRefused: true };
      }

      const role = await resolveRole(tx, params);
      const [revived] = await tx
        .update(teamMembers)
        .set({
          role,
          deletedAt: null,
          clerkMembershipId: params.clerkMembershipId ?? existing.clerkMembershipId,
        })
        .where(eq(teamMembers.id, existing.id))
        .returning();
      return { member: revived ?? null, created: false };
    }

    const role = await resolveRole(tx, params);

    const [inserted] = await tx
      .insert(teamMembers)
      .values({
        agencyId: params.agencyId,
        userId: params.userId,
        role,
        clerkMembershipId: params.clerkMembershipId ?? null,
      })
      .returning();

    return { member: inserted, created: true };
  });
}

export async function listMembers(agencyId: string) {
  return db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      imageUrl: users.imageUrl,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.agencyId, agencyId), isNull(teamMembers.deletedAt)))
    .orderBy(asc(teamMembers.createdAt));
}

/**
 * Creates our invitations row (source of truth for the real role) and asks
 * Clerk to send the actual email. DB row first, Clerk second: if Clerk's
 * call fails the row is reverted to 'revoked' and the error rethrown, so a
 * pending row never exists without a sent email having at least been
 * attempted. Re-invites reuse the existing (agencyId, email) row — the
 * unique constraint spans all statuses, not just pending.
 */
export async function inviteMember(params: {
  agencyId: string;
  clerkOrgId: string;
  actor: { userId: string; role: TeamMemberRole };
  email: string;
  role: Exclude<TeamMemberRole, "owner">;
  gateway: ClerkGateway;
}) {
  if (params.actor.role !== "owner" && params.actor.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can invite." });
  }

  const invitationRow = await txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    // Already an active member with this email?
    const [existingMember] = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.agencyId, params.agencyId),
          eq(users.email, params.email),
          isNull(teamMembers.deletedAt)
        )
      )
      .limit(1);

    if (existingMember) {
      throw new TRPCError({ code: "CONFLICT", message: "Already a member of this team." });
    }

    const [existingInvitation] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.agencyId, params.agencyId), eq(invitations.email, params.email)))
      .limit(1);

    if (existingInvitation?.status === "pending") {
      throw new TRPCError({ code: "CONFLICT", message: "An invitation is already pending." });
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    if (existingInvitation) {
      const [updated] = await tx
        .update(invitations)
        .set({
          role: params.role,
          status: "pending",
          invitedById: params.actor.userId,
          expiresAt,
          acceptedAt: null,
          clerkInvitationId: null,
        })
        .where(eq(invitations.id, existingInvitation.id))
        .returning();
      return updated;
    }

    const [inserted] = await tx
      .insert(invitations)
      .values({
        agencyId: params.agencyId,
        email: params.email,
        role: params.role,
        invitedById: params.actor.userId,
        expiresAt,
      })
      .returning();
    return inserted;
  });

  if (!invitationRow) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create invitation." });
  }

  try {
    const clerkInvitationId = await params.gateway.createOrganizationInvitation({
      clerkOrgId: params.clerkOrgId,
      inviterUserId: params.actor.userId,
      email: params.email,
      clerkRole: params.role === "admin" ? "org:admin" : "org:member",
    });
    const [updated] = await db
      .update(invitations)
      .set({ clerkInvitationId })
      .where(eq(invitations.id, invitationRow.id))
      .returning();
    return updated;
  } catch (err) {
    await db
      .update(invitations)
      .set({ status: "revoked" })
      .where(eq(invitations.id, invitationRow.id));
    throw err;
  }
}

/**
 * Role matrix for member administration: owner can change/remove anyone
 * except owners; admin only manager/operator. Owners are never touched via
 * these two — owner changes go exclusively through transfer/promote/
 * stepDown/recovery, which carry their own guards.
 */
function assertCanAdminister(
  actor: { id: string; role: TeamMemberRole },
  target: { id: string; role: TeamMemberRole }
) {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can manage members." });
  }
  if (target.id === actor.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't manage your own membership here." });
  }
  if (target.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owners can't be changed or removed this way.",
    });
  }
  if (actor.role === "admin" && target.role === "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admins can't manage other admins." });
  }
}

export async function updateMemberRole(params: {
  agencyId: string;
  actor: { userId: string };
  memberId: string;
  role: Exclude<TeamMemberRole, "owner">;
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const actor = await activeMemberByUser(tx, params.agencyId, params.actor.userId);
    const target = await activeMemberById(tx, params.agencyId, params.memberId);
    if (!actor || !target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    }
    assertCanAdminister(actor, target);

    const [updated] = await tx
      .update(teamMembers)
      .set({ role: params.role })
      .where(eq(teamMembers.id, target.id))
      .returning();
    return updated;
  });
}

/**
 * Removal is two systems, ordered like inviteMember: our soft-delete first
 * (inside the locked transaction, where the role-matrix guards live), then
 * the Clerk org removal. If Clerk fails, a compensating conditional
 * un-delete reverts ours and rethrows — so removal is all-or-nothing from
 * the admin's perspective. Without the Clerk half, our soft-delete is
 * cosmetic (the member keeps their org claim and full product access).
 *
 * KNOWN, ACCEPTED TAIL: after Clerk-side removal, the removed member's
 * existing session token stays valid until Clerk's refresh cycle (~60s),
 * during which agencyProcedure (org-claim-based) still admits them. This
 * discloses nothing new — they had legitimate access moments earlier, and
 * anything they can see in the tail is the same data they could see then.
 * Closing it would mean membership checks on every procedure
 * (teamProcedure everywhere), which reintroduces a bootstrap race for
 * brand-new users. Revisit only if a compliance need demands it.
 * The revival gate in ensureMembership is what makes the removal STICK:
 * their next page load can no longer silently re-provision them.
 */
export async function removeMember(params: {
  agencyId: string;
  clerkOrgId: string;
  actor: { userId: string };
  memberId: string;
  gateway: ClerkGateway;
}) {
  const removedAt = new Date();

  const target = await txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const actor = await activeMemberByUser(tx, params.agencyId, params.actor.userId);
    const targetRow = await activeMemberById(tx, params.agencyId, params.memberId);
    if (!actor || !targetRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    }
    assertCanAdminister(actor, targetRow);

    await tx
      .update(teamMembers)
      .set({ deletedAt: removedAt })
      .where(eq(teamMembers.id, targetRow.id));
    return targetRow;
  });

  try {
    await params.gateway.removeOrganizationMember({
      clerkOrgId: params.clerkOrgId,
      clerkUserId: target.userId,
    });
  } catch (err) {
    // Compensate: revert ONLY if our soft-delete is still the exact one we
    // wrote (deletedAt matches), so an intervening state change (however
    // unlikely under per-agency serialization) can't be clobbered.
    await db
      .update(teamMembers)
      .set({ deletedAt: null })
      .where(and(eq(teamMembers.id, target.id), eq(teamMembers.deletedAt, removedAt)));
    throw err;
  }

  return { id: target.id };
}

/** Swap: actor (owner) -> admin, target -> owner. Owner count unchanged. */
export async function transferOwnership(params: {
  agencyId: string;
  actor: { userId: string };
  toMemberId: string;
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const actor = await activeMemberByUser(tx, params.agencyId, params.actor.userId);
    requireOwnerActor(actor);

    const target = await activeMemberById(tx, params.agencyId, params.toMemberId);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    if (target.id === actor.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You already own this agency." });
    }
    if (target.role === "owner") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "They're already an owner." });
    }

    await tx.update(teamMembers).set({ role: "admin" }).where(eq(teamMembers.id, actor.id));
    const [newOwner] = await tx
      .update(teamMembers)
      .set({ role: "owner" })
      .where(eq(teamMembers.id, target.id))
      .returning();
    return newOwner;
  });
}

/** The opt-in-to-multi-owner action: adds an owner without demoting anyone. */
export async function promoteToCoOwner(params: {
  agencyId: string;
  actor: { userId: string };
  toMemberId: string;
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const actor = await activeMemberByUser(tx, params.agencyId, params.actor.userId);
    requireOwnerActor(actor);

    const target = await activeMemberById(tx, params.agencyId, params.toMemberId);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
    if (target.role === "owner") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "They're already an owner." });
    }

    const [promoted] = await tx
      .update(teamMembers)
      .set({ role: "owner" })
      .where(eq(teamMembers.id, target.id))
      .returning();
    return promoted;
  });
}

/** Self-demote to admin — only if it wouldn't leave the agency ownerless. */
export async function stepDownAsOwner(params: { agencyId: string; actor: { userId: string } }) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const actor = await activeMemberByUser(tx, params.agencyId, params.actor.userId);
    requireOwnerActor(actor);

    const owners = await activeOwners(tx, params.agencyId);
    if (owners.length <= 1) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "You're the only owner. Transfer ownership (or promote a co-owner first) — an agency can't have zero owners.",
      });
    }

    const [demoted] = await tx
      .update(teamMembers)
      .set({ role: "admin" })
      .where(eq(teamMembers.id, actor.id))
      .returning();
    return demoted;
  });
}
