import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, teamMembers } from "@ojaven/db";
import {
  ensureMembership,
  promoteToCoOwner,
  removeMember,
  stepDownAsOwner,
  transferOwnership,
  updateMemberRole,
} from "../src/services/teamMembership";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser, stubGateway } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

/** Seed an agency with an owner + one member per requested role. */
async function seedTeam(...roles: Array<"admin" | "manager" | "operator">) {
  const agency = await seedAgency();
  agencyIds.push(agency.id);

  const ownerUser = await seedUser("owner");
  userIds.push(ownerUser.id);
  const { member: ownerMember } = await ensureMembership({
    agencyId: agency.id,
    userId: ownerUser.id,
  });

  const members = [];
  for (const role of roles) {
    const user = await seedUser(role);
    userIds.push(user.id);
    const { member } = await ensureMembership({ agencyId: agency.id, userId: user.id });
    const [updated] = await db
      .update(teamMembers)
      .set({ role })
      .where(eq(teamMembers.id, member!.id))
      .returning();
    members.push({ user, member: updated! });
  }

  return { agency, ownerUser, ownerMember: ownerMember!, members };
}

async function roleOf(memberId: string) {
  const [row] = await db.select().from(teamMembers).where(eq(teamMembers.id, memberId));
  return row;
}

describe("transferOwnership", () => {
  it("swaps: actor becomes admin, target becomes owner", async () => {
    const { agency, ownerUser, ownerMember, members } = await seedTeam("manager");
    const target = members[0]!;

    await transferOwnership({
      agencyId: agency.id,
      actor: { userId: ownerUser.id },
      toMemberId: target.member.id,
    });

    expect((await roleOf(ownerMember.id))?.role).toBe("admin");
    expect((await roleOf(target.member.id))?.role).toBe("owner");
  });

  it("refuses non-owner actors", async () => {
    const { agency, members } = await seedTeam("admin", "operator");
    await expect(
      transferOwnership({
        agencyId: agency.id,
        actor: { userId: members[0]!.user.id },
        toMemberId: members[1]!.member.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("promoteToCoOwner / stepDownAsOwner", () => {
  it("promote adds a second owner; step down then works; last owner can't step down", async () => {
    const { agency, ownerUser, ownerMember, members } = await seedTeam("admin");
    const coOwner = members[0]!;

    // Sole owner can't step down.
    await expect(
      stepDownAsOwner({ agencyId: agency.id, actor: { userId: ownerUser.id } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await promoteToCoOwner({
      agencyId: agency.id,
      actor: { userId: ownerUser.id },
      toMemberId: coOwner.member.id,
    });
    expect((await roleOf(coOwner.member.id))?.role).toBe("owner");

    // Two owners now — stepping down is allowed.
    await stepDownAsOwner({ agencyId: agency.id, actor: { userId: ownerUser.id } });
    expect((await roleOf(ownerMember.id))?.role).toBe("admin");

    // And the remaining owner is once again the last one — guarded.
    await expect(
      stepDownAsOwner({ agencyId: agency.id, actor: { userId: coOwner.user.id } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("updateMemberRole / removeMember role matrix", () => {
  it("owner can change and remove non-owners, but not owners", async () => {
    const { agency, ownerUser, members } = await seedTeam("admin", "operator");
    const [admin, operator] = members;

    const updated = await updateMemberRole({
      agencyId: agency.id,
      actor: { userId: ownerUser.id },
      memberId: operator!.member.id,
      role: "manager",
    });
    expect(updated?.role).toBe("manager");

    // Promote admin to co-owner, then try to administer them — refused.
    await promoteToCoOwner({
      agencyId: agency.id,
      actor: { userId: ownerUser.id },
      toMemberId: admin!.member.id,
    });
    await expect(
      removeMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: ownerUser.id },
        memberId: admin!.member.id,
        gateway: stubGateway().gateway,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin can manage manager/operator but not another admin", async () => {
    const { agency, members } = await seedTeam("admin", "admin", "operator");
    const [adminA, adminB, operator] = members;

    const removed = await removeMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: adminA!.user.id },
      memberId: operator!.member.id,
      gateway: stubGateway().gateway,
    });
    expect(removed?.id).toBe(operator!.member.id);
    const [operatorRow] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, operator!.member.id));
    expect(operatorRow?.deletedAt).not.toBeNull(); // soft-delete, not hard

    await expect(
      updateMemberRole({
        agencyId: agency.id,
        actor: { userId: adminA!.user.id },
        memberId: adminB!.member.id,
        role: "operator",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("manager and operator can't administer at all; self-management refused", async () => {
    const { agency, ownerUser, ownerMember, members } = await seedTeam("manager", "operator");
    const [manager, operator] = members;

    await expect(
      removeMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: manager!.user.id },
        memberId: operator!.member.id,
        gateway: stubGateway().gateway,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      updateMemberRole({
        agencyId: agency.id,
        actor: { userId: ownerUser.id },
        memberId: ownerMember.id,
        role: "admin",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
