import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, invitations, teamMembers } from "@ojaven/db";
import { TRPCError } from "@trpc/server";
import { ensureMembership, inviteMember, listMembers } from "../src/services/teamMembership";
import { inviteTeamMemberSchema } from "@ojaven/shared";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser, stubGateway } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

async function freshAgency() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  return agency;
}

async function freshUser(label?: string) {
  const user = await seedUser(label);
  userIds.push(user.id);
  return user;
}

describe("ensureMembership", () => {
  it("makes the first member owner, the second operator", async () => {
    const agency = await freshAgency();
    const first = await freshUser("first");
    const second = await freshUser("second");

    const a = await ensureMembership({ agencyId: agency.id, userId: first.id });
    expect(a.created).toBe(true);
    expect(a.member?.role).toBe("owner");

    const b = await ensureMembership({ agencyId: agency.id, userId: second.id });
    expect(b.created).toBe(true);
    expect(b.member?.role).toBe("operator");
  });

  it("maps clerk org:admin to admin for non-first members", async () => {
    const agency = await freshAgency();
    const first = await freshUser();
    const admin = await freshUser("admin");

    await ensureMembership({ agencyId: agency.id, userId: first.id });
    const result = await ensureMembership({
      agencyId: agency.id,
      userId: admin.id,
      clerkOrgRole: "org:admin",
    });
    expect(result.member?.role).toBe("admin");
  });

  it("is idempotent — second call returns the same row, no duplicate", async () => {
    const agency = await freshAgency();
    const user = await freshUser();

    const first = await ensureMembership({ agencyId: agency.id, userId: user.id });
    const again = await ensureMembership({ agencyId: agency.id, userId: user.id });

    expect(again.created).toBe(false);
    expect(again.member?.id).toBe(first.member?.id);

    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.agencyId, agency.id), eq(teamMembers.userId, user.id)));
    expect(rows).toHaveLength(1);
  });

  it("uses a pending invitation's role and marks it accepted", async () => {
    const agency = await freshAgency();
    const owner = await freshUser("owner");
    const invitee = await freshUser("invitee");
    await ensureMembership({ agencyId: agency.id, userId: owner.id });

    await db.insert(invitations).values({
      agencyId: agency.id,
      email: invitee.email,
      role: "manager",
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await ensureMembership({ agencyId: agency.id, userId: invitee.id });
    expect(result.member?.role).toBe("manager");

    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.agencyId, agency.id), eq(invitations.email, invitee.email)));
    expect(invitation?.status).toBe("accepted");
    expect(invitation?.acceptedAt).not.toBeNull();
  });

  it("REGRESSION: does NOT revive a removed member on a bare call (layout-effect shape)", async () => {
    // The original version of this test asserted bare revival — that
    // expectation WAS the bug: a removed member's next page load fired
    // ensureMembership (no clerkMembershipId, no invitation) and silently
    // un-removed them. Bare calls must now refuse.
    const agency = await freshAgency();
    const owner = await freshUser();
    const removed = await freshUser("removed");
    await ensureMembership({ agencyId: agency.id, userId: owner.id });

    const original = await ensureMembership({ agencyId: agency.id, userId: removed.id });
    await db
      .update(teamMembers)
      .set({ deletedAt: new Date() })
      .where(eq(teamMembers.id, original.member!.id));

    const attempt = await ensureMembership({ agencyId: agency.id, userId: removed.id });
    expect(attempt.member).toBeNull();
    expect("revivalRefused" in attempt && attempt.revivalRefused).toBe(true);

    const [row] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, original.member!.id));
    expect(row?.deletedAt).not.toBeNull(); // still removed
  });

  it("RACE: concurrent first-joins of a brand-new agency produce exactly one owner", async () => {
    const agency = await freshAgency();
    const contenders = await Promise.all(
      Array.from({ length: 6 }, (_, i) => freshUser(`racer${i}`))
    );

    await Promise.all(
      contenders.map((user) => ensureMembership({ agencyId: agency.id, userId: user.id }))
    );

    const owners = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.agencyId, agency.id),
          eq(teamMembers.role, "owner"),
          isNull(teamMembers.deletedAt)
        )
      );
    expect(owners).toHaveLength(1);

    const all = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.agencyId, agency.id), isNull(teamMembers.deletedAt)));
    expect(all).toHaveLength(contenders.length);
  });
});

describe("inviteMember", () => {
  it("rejects role owner at the schema level", () => {
    const parsed = inviteTeamMemberSchema.safeParse({ email: "x@y.com", role: "owner" });
    expect(parsed.success).toBe(false);
  });

  it("creates our row and calls Clerk; admin maps to org:admin", async () => {
    const agency = await freshAgency();
    const owner = await freshUser();
    await ensureMembership({ agencyId: agency.id, userId: owner.id });
    const { gateway, sentInvitations } = stubGateway();

    const invitation = await inviteMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: owner.id, role: "owner" },
      email: "new-admin@test.ojaven.local",
      role: "admin",
      gateway,
    });

    expect(invitation?.status).toBe("pending");
    expect(invitation?.clerkInvitationId).toMatch(/^orginv_test_/);
    expect(sentInvitations).toEqual([
      { email: "new-admin@test.ojaven.local", clerkRole: "org:admin" },
    ]);
  });

  it("refuses duplicate pending invitations and non-admin actors", async () => {
    const agency = await freshAgency();
    const owner = await freshUser();
    await ensureMembership({ agencyId: agency.id, userId: owner.id });
    const { gateway } = stubGateway();

    await inviteMember({
      agencyId: agency.id,
      clerkOrgId: agency.clerkOrgId,
      actor: { userId: owner.id, role: "owner" },
      email: "dupe@test.ojaven.local",
      role: "operator",
      gateway,
    });

    await expect(
      inviteMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: owner.id, role: "owner" },
        email: "dupe@test.ojaven.local",
        role: "operator",
        gateway,
      })
    ).rejects.toThrowError(TRPCError);

    await expect(
      inviteMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: owner.id, role: "manager" },
        email: "other@test.ojaven.local",
        role: "operator",
        gateway,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reverts the row to revoked when Clerk send fails", async () => {
    const agency = await freshAgency();
    const owner = await freshUser();
    await ensureMembership({ agencyId: agency.id, userId: owner.id });
    const { gateway } = stubGateway();
    gateway.createOrganizationInvitation = async () => {
      throw new Error("clerk down");
    };

    await expect(
      inviteMember({
        agencyId: agency.id,
        clerkOrgId: agency.clerkOrgId,
        actor: { userId: owner.id, role: "owner" },
        email: "fail@test.ojaven.local",
        role: "operator",
        gateway,
      })
    ).rejects.toThrow("clerk down");

    const [row] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.agencyId, agency.id), eq(invitations.email, "fail@test.ojaven.local")));
    expect(row?.status).toBe("revoked");
  });
});

describe("listMembers", () => {
  it("returns active members with user info, oldest first", async () => {
    const agency = await freshAgency();
    const owner = await freshUser("alpha");
    const operator = await freshUser("beta");
    await ensureMembership({ agencyId: agency.id, userId: owner.id });
    await ensureMembership({ agencyId: agency.id, userId: operator.id });

    const members = await listMembers(agency.id);
    expect(members).toHaveLength(2);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.email).toBe(owner.email);
    expect(members[1]?.role).toBe("operator");
  });
});
