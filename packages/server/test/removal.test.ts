import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, invitations, teamMembers } from "@ojaven/db";
import { ensureMembership, inviteMember, removeMember } from "../src/services/teamMembership";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser, stubGateway } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

/** Owner + one operator, returning everything removal tests need. */
async function seedRemovalScene() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  const ownerUser = await seedUser("owner");
  const operatorUser = await seedUser("operator");
  userIds.push(ownerUser.id, operatorUser.id);

  await ensureMembership({ agencyId: agency.id, userId: ownerUser.id });
  const { member: operatorMember } = await ensureMembership({
    agencyId: agency.id,
    userId: operatorUser.id,
    clerkMembershipId: `orgmem_test_${randomUUID()}`,
  });

  return { agency, ownerUser, operatorUser, operatorMember: operatorMember! };
}

async function memberRow(id: string) {
  const [row] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return row;
}

describe("removeMember -> Clerk propagation", () => {
  it("soft-deletes our row AND calls Clerk with the right org/user", async () => {
    const { agency, ownerUser, operatorUser, operatorMember } = await seedRemovalScene();
    const { gateway, removedMembers } = stubGateway();

    await removeMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: ownerUser.id },
      memberId: operatorMember.id,
      gateway,
    });

    expect((await memberRow(operatorMember.id))?.deletedAt).not.toBeNull();
    expect(removedMembers).toEqual([
      { clerkOrgId: agency.clerkOrgId, clerkUserId: operatorUser.id },
    ]);
  });

  it("compensates (un-deletes) and rethrows when the Clerk call fails", async () => {
    const { agency, ownerUser, operatorMember } = await seedRemovalScene();
    const { gateway } = stubGateway();
    gateway.removeOrganizationMember = async () => {
      throw new Error("clerk down");
    };

    await expect(
      removeMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: ownerUser.id },
        memberId: operatorMember.id,
        gateway,
      })
    ).rejects.toThrow("clerk down");

    // All-or-nothing: the member is still active, not half-removed.
    expect((await memberRow(operatorMember.id))?.deletedAt).toBeNull();
  });
});

describe("evidence-based revival", () => {
  it("full re-invite round trip: remove -> invite -> ensureMembership revives with the NEW role", async () => {
    const { agency, ownerUser, operatorUser, operatorMember } = await seedRemovalScene();
    const { gateway } = stubGateway();

    await removeMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: ownerUser.id },
      memberId: operatorMember.id,
      gateway,
    });

    // Re-invite through our flow — resets the existing (agency, email)
    // invitation row (accepted on first join) back to pending.
    await inviteMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: ownerUser.id, role: "owner" },
      email: operatorUser.email,
      role: "manager",
      gateway,
    });

    const revived = await ensureMembership({ agencyId: agency.id, userId: operatorUser.id });
    expect(revived.member?.id).toBe(operatorMember.id); // same row, revived
    expect(revived.member?.role).toBe("manager"); // NEW role from the invitation
    expect(revived.member?.deletedAt).toBeNull();

    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.email, operatorUser.email));
    expect(invitation?.status).toBe("accepted");
  });

  it("revives on a FRESH clerkMembershipId (Clerk re-admitted them)", async () => {
    const { agency, ownerUser, operatorUser, operatorMember } = await seedRemovalScene();
    const { gateway } = stubGateway();
    await removeMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: ownerUser.id },
      memberId: operatorMember.id,
      gateway,
    });

    const revived = await ensureMembership({
      agencyId: agency.id,
      userId: operatorUser.id,
      clerkOrgRole: "org:member",
      clerkMembershipId: `orgmem_test_${randomUUID()}`, // different from stored
    });
    expect(revived.member?.id).toBe(operatorMember.id);
    expect(revived.member?.deletedAt).toBeNull();
  });

  it("refuses revival on the SAME clerkMembershipId (stale webhook redelivery)", async () => {
    const { agency, ownerUser, operatorUser, operatorMember } = await seedRemovalScene();
    const { gateway } = stubGateway();
    await removeMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: ownerUser.id },
      memberId: operatorMember.id,
      gateway,
    });

    const attempt = await ensureMembership({
      agencyId: agency.id,
      userId: operatorUser.id,
      clerkOrgRole: "org:member",
      clerkMembershipId: operatorMember.clerkMembershipId, // the stored id — a redelivery
    });
    expect(attempt.member).toBeNull();
    expect((await memberRow(operatorMember.id))?.deletedAt).not.toBeNull();
  });
});
