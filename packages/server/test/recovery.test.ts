import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, notifications, teamMembers } from "@ojaven/db";
import { ensureMembership, promoteToCoOwner } from "../src/services/teamMembership";
import {
  cancelOwnershipRecovery,
  completeOwnershipRecovery,
  requestOwnershipRecovery,
} from "../src/services/ownershipRecovery";
import {
  DAY_MS,
  backdateRecoveryRequest,
  cleanupAgencies,
  cleanupUsers,
  getAgencyRecoveryState,
  seedAgency,
  seedUser,
  stubGateway,
} from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

/** Agency with one owner and one admin (the recovery protagonist). */
async function seedRecoveryScene() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);

  const ownerUser = await seedUser("owner");
  const adminUser = await seedUser("admin");
  userIds.push(ownerUser.id, adminUser.id);

  const { member: ownerMember } = await ensureMembership({
    agencyId: agency.id,
    userId: ownerUser.id,
  });
  const { member: adminMember } = await ensureMembership({
    agencyId: agency.id,
    userId: adminUser.id,
    clerkOrgRole: "org:admin",
  });

  return { agency, ownerUser, adminUser, ownerMember: ownerMember!, adminMember: adminMember! };
}

const now = Date.now();
const INACTIVE = now - 45 * DAY_MS; // beyond 30-day threshold
const ACTIVE = now - 2 * DAY_MS; // well within it

describe("requestOwnershipRecovery", () => {
  it("refuses while any owner is active, naming them", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const { gateway } = stubGateway({ [ownerUser.id]: ACTIVE });

    await expect(
      requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("refuses non-admin actors", async () => {
    const { agency, ownerUser } = await seedRecoveryScene();
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });

    // The owner themselves isn't an admin — refused.
    await expect(
      requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: ownerUser.id }, gateway, now })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("succeeds when all owners are inactive; writes state + audit notifications", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });

    const result = await requestOwnershipRecovery({
      agencyId: agency.id,
      actor: { userId: adminUser.id },
      gateway,
      now,
    });
    expect(result.graceEndsAt.getTime()).toBe(now + 14 * DAY_MS);

    const state = await getAgencyRecoveryState(agency.id);
    expect(state?.requestedById).toBe(adminUser.id);
    expect(state?.requestedAt?.getTime()).toBe(now);

    const audit = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.agencyId, agency.id), eq(notifications.userId, ownerUser.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.title).toMatch(/recovery requested/i);
  });

  it("treats a never-signed-in / Clerk-deleted owner as inactive", async () => {
    const { agency, adminUser } = await seedRecoveryScene();
    // Stub has NO entry for the owner at all — like a deleted Clerk account.
    const { gateway } = stubGateway({});

    const result = await requestOwnershipRecovery({
      agencyId: agency.id,
      actor: { userId: adminUser.id },
      gateway,
      now,
    });
    expect(result.requestedAt.getTime()).toBe(now);
  });

  it("blocks duplicate/competing requests during grace, allows supersede after", async () => {
    const scene = await seedRecoveryScene();
    const secondAdminUser = await seedUser("admin2");
    userIds.push(secondAdminUser.id);
    await ensureMembership({
      agencyId: scene.agency.id,
      userId: secondAdminUser.id,
      clerkOrgRole: "org:admin",
    });
    const { gateway } = stubGateway({ [scene.ownerUser.id]: INACTIVE });

    await requestOwnershipRecovery({
      agencyId: scene.agency.id,
      actor: { userId: scene.adminUser.id },
      gateway,
      now,
    });

    // Same admin again: refused. Different admin during grace: refused.
    await expect(
      requestOwnershipRecovery({
        agencyId: scene.agency.id,
        actor: { userId: scene.adminUser.id },
        gateway,
        now: now + DAY_MS,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      requestOwnershipRecovery({
        agencyId: scene.agency.id,
        actor: { userId: secondAdminUser.id },
        gateway,
        now: now + DAY_MS,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // After the grace fully elapses uncompleted, a different admin may
    // supersede (prevents deadlock when the requester themselves vanished).
    const afterGrace = now + 15 * DAY_MS;
    const superseded = await requestOwnershipRecovery({
      agencyId: scene.agency.id,
      actor: { userId: secondAdminUser.id },
      gateway,
      now: afterGrace,
    });
    expect(superseded.requestedAt.getTime()).toBe(afterGrace);
    const state = await getAgencyRecoveryState(scene.agency.id);
    expect(state?.requestedById).toBe(secondAdminUser.id);
  });
});

describe("cancelOwnershipRecovery", () => {
  it("requester cancels their own; anyone else is refused", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const otherAdminUser = await seedUser("admin2");
    userIds.push(otherAdminUser.id);
    await ensureMembership({
      agencyId: agency.id,
      userId: otherAdminUser.id,
      clerkOrgRole: "org:admin",
    });
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });

    await requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now });

    await expect(
      cancelOwnershipRecovery({ agencyId: agency.id, actor: { userId: otherAdminUser.id } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const result = await cancelOwnershipRecovery({
      agencyId: agency.id,
      actor: { userId: adminUser.id },
    });
    expect(result.cancelled).toBe(true);
    const state = await getAgencyRecoveryState(agency.id);
    expect(state?.requestedAt).toBeNull();
  });
});

describe("completeOwnershipRecovery", () => {
  it("refuses before grace, refuses non-requester", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const otherAdminUser = await seedUser("admin2");
    userIds.push(otherAdminUser.id);
    await ensureMembership({
      agencyId: agency.id,
      userId: otherAdminUser.id,
      clerkOrgRole: "org:admin",
    });
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });

    await requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now });

    await expect(
      completeOwnershipRecovery({
        agencyId: agency.id,
        actor: { userId: adminUser.id },
        gateway,
        now: now + 7 * DAY_MS, // mid-grace
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await expect(
      completeOwnershipRecovery({
        agencyId: agency.id,
        actor: { userId: otherAdminUser.id },
        gateway,
        now: now + 15 * DAY_MS,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner sign-in since the request invalidates it at completion", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });
    await requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now });

    // Owner authenticated two days after the request was filed.
    const { gateway: laterGateway } = stubGateway({ [ownerUser.id]: now + 2 * DAY_MS });

    await expect(
      completeOwnershipRecovery({
        agencyId: agency.id,
        actor: { userId: adminUser.id },
        gateway: laterGateway,
        now: now + 15 * DAY_MS,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Invalidated, not left pending.
    const state = await getAgencyRecoveryState(agency.id);
    expect(state?.requestedAt).toBeNull();
  });

  it("a co-owner promoted during grace blocks completion if they're active", async () => {
    const { agency, ownerUser, adminUser } = await seedRecoveryScene();
    const promoteeUser = await seedUser("promotee");
    userIds.push(promoteeUser.id);
    const { member: promoteeMember } = await ensureMembership({
      agencyId: agency.id,
      userId: promoteeUser.id,
    });

    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });
    await requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now });

    // Original owner briefly returns mid-grace and promotes a co-owner.
    await promoteToCoOwner({
      agencyId: agency.id,
      actor: { userId: ownerUser.id },
      toMemberId: promoteeMember!.id,
    });

    // At completion the promotee is a current owner with recent activity.
    const { gateway: completionGateway } = stubGateway({
      [ownerUser.id]: INACTIVE,
      [promoteeUser.id]: now + 5 * DAY_MS,
    });

    await expect(
      completeOwnershipRecovery({
        agencyId: agency.id,
        actor: { userId: adminUser.id },
        gateway: completionGateway,
        now: now + 15 * DAY_MS,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("happy path: demotes all owners to admin, promotes requester, clears state, writes audit", async () => {
    const { agency, ownerUser, adminUser, ownerMember, adminMember } = await seedRecoveryScene();
    const { gateway } = stubGateway({ [ownerUser.id]: INACTIVE });

    await requestOwnershipRecovery({ agencyId: agency.id, actor: { userId: adminUser.id }, gateway, now });
    // Simulate real elapsed time rather than trusting `now` plumbing alone.
    await backdateRecoveryRequest(agency.id, now - 15 * DAY_MS);

    const result = await completeOwnershipRecovery({
      agencyId: agency.id,
      actor: { userId: adminUser.id },
      gateway,
    });

    expect(result.newOwner?.id).toBe(adminMember.id);
    expect(result.newOwner?.role).toBe("owner");
    expect(result.demotedOwnerIds).toEqual([ownerMember.id]);

    const [oldOwnerRow] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, ownerMember.id));
    expect(oldOwnerRow?.role).toBe("admin"); // demoted, not removed
    expect(oldOwnerRow?.deletedAt).toBeNull();

    const state = await getAgencyRecoveryState(agency.id);
    expect(state?.requestedAt).toBeNull();
    expect(state?.requestedById).toBeNull();

    const audit = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.agencyId, agency.id), eq(notifications.userId, ownerUser.id)));
    expect(audit.some((n) => /recovered/i.test(n.title))).toBe(true);
  });
});
