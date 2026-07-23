import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agencySettings, auditLogs, db, invitations, notifications, teamMembers } from "@ojaven/db";
import { logger } from "@ojaven/shared";
import { createCallerFactory } from "../src/trpc";
import { appRouter } from "../src/routers/_app";
import { sanitizeForAudit, uuidish } from "../src/services/audit";
import { sendProposal } from "../src/services/proposals";
import { respondToProposal } from "../src/services/publicProposals";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "../src/services/notifications";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];
afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

const createCaller = createCallerFactory(appRouter);

/**
 * A full-stack caller: seeded user + agency + settings mean requireAuth,
 * requireAgency, and ensureAgencySettings all hit their fast paths — the whole
 * middleware chain runs with zero Clerk network calls. First tests in the
 * codebase that exercise procedures INCLUDING middleware.
 */
async function fullStackCaller() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  await db
    .insert(agencySettings)
    .values({ agencyId: agency.id, subdomain: `aud-${randomUUID().slice(0, 12)}` });
  const user = await seedUser("caller");
  userIds.push(user.id);
  const caller = createCaller({
    db,
    logger,
    userId: user.id,
    clerkOrgId: agency.clerkOrgId,
    clerkOrgRole: null,
    ip: null,
  });
  return { agency, user, caller };
}

const auditRows = (agencyId: string, action: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.agencyId, agencyId), eq(auditLogs.action, action)));

describe("audit middleware (full procedure stack)", () => {
  it("audits a create: path action, actor, agency, entityId from the RESULT row", async () => {
    const { agency, user, caller } = await fullStackCaller();
    const client = await caller.clients.create({ name: "Audited Co", status: "prospect" });

    const rows = await auditRows(agency.id, "clients.create");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(user.id);
    expect(rows[0]?.entityId).toBe(client!.id); // came from the output row
    expect((rows[0]?.changes as { input: { name: string } }).input.name).toBe("Audited Co");
  });

  it("audits an update with entityId from the INPUT; a failed mutation is NOT audited", async () => {
    const { agency, caller } = await fullStackCaller();
    const client = await caller.clients.create({ name: "Before", status: "prospect" });
    await caller.clients.update({ id: client!.id, name: "After" });

    let rows = await auditRows(agency.id, "clients.update");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(client!.id);

    // Failed mutation (nonexistent id) -> no new audit row.
    await expect(
      caller.clients.update({ id: randomUUID(), name: "ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    rows = await auditRows(agency.id, "clients.update");
    expect(rows).toHaveLength(1); // unchanged
  });

  it("queries are never audited", async () => {
    const { agency, caller } = await fullStackCaller();
    await caller.clients.list();
    expect(await auditRows(agency.id, "clients.list")).toHaveLength(0);
  });

  it("truncates oversized input in the stored snapshot", async () => {
    const { agency, caller } = await fullStackCaller();
    const client = await caller.clients.create({ name: "C", status: "prospect" });
    await caller.proposals.create({
      clientId: client!.id,
      title: "Big",
      bodyHtml: "x".repeat(5000),
    });

    const [row] = await auditRows(agency.id, "proposals.create");
    const stored = (row?.changes as { input: { bodyHtml: string } }).input.bodyHtml;
    expect(stored).toContain("[truncated 4500 chars]");
    expect(stored.length).toBeLessThan(600);
  });

  it("public proposal accept writes an explicit anonymous audit — and never the token", async () => {
    const { agency, caller } = await fullStackCaller();
    const client = await caller.clients.create({ name: "P", status: "prospect" });
    const proposal = await caller.proposals.create({ clientId: client!.id, title: "Deal" });
    const sent = await sendProposal({ agencyId: agency.id, id: proposal!.id });

    await respondToProposal({ token: sent.publicToken!, decision: "accept", signedByName: "Jo Client" });

    const rows = await auditRows(agency.id, "proposal.accepted");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBeNull(); // anonymous public actor
    expect(rows[0]?.entityType).toBe("proposal");
    expect(rows[0]?.entityId).toBe(proposal!.id);
    expect((rows[0]?.changes as { signedByName: string }).signedByName).toBe("Jo Client");
    expect(JSON.stringify(rows[0]?.changes)).not.toContain(sent.publicToken!); // token never stored
  });
});

describe("ensureMembership audit semantics (noise fix)", () => {
  it("audits joins and rejoins semantically — never the idempotent no-op", async () => {
    const { agency, user, caller } = await fullStackCaller();

    // First call creates (first member -> owner) -> ONE semantic row, and the
    // baseline path row must NOT exist (exempted).
    await caller.team.ensureMembership();
    expect(await auditRows(agency.id, "team.member_joined")).toHaveLength(1);
    expect(await auditRows(agency.id, "team.ensureMembership")).toHaveLength(0);

    // Idempotent no-op (the every-page-load case) -> nothing new.
    await caller.team.ensureMembership();
    expect(await auditRows(agency.id, "team.member_joined")).toHaveLength(1);

    // Revival with evidence (pending invitation) -> a rejoin row.
    const [memberRow] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.agencyId, agency.id), eq(teamMembers.userId, user.id)));
    await db.update(teamMembers).set({ deletedAt: new Date() }).where(eq(teamMembers.id, memberRow!.id));
    await db.insert(invitations).values({
      agencyId: agency.id,
      email: user.email,
      role: "manager",
      expiresAt: new Date(Date.now() + 86400000),
    });
    await caller.team.ensureMembership();
    const rejoined = await auditRows(agency.id, "team.member_rejoined");
    expect(rejoined).toHaveLength(1);
    expect((rejoined[0]?.changes as { role: string }).role).toBe("manager"); // the invitation's role
  });
});

describe("health.limiterStatus (authenticated canary)", () => {
  it("returns the fail-open canary shape via the full stack", async () => {
    const { caller } = await fullStackCaller();
    const status = await caller.health.limiterStatus();
    expect(typeof status.active).toBe("boolean");
    expect(typeof status.failuresSinceBoot).toBe("number");
    expect(status.failuresSinceBoot).toBeGreaterThanOrEqual(0);
    // lastFailureAt is null until a real fail-open occurs (proven in the live drill).
  });
});

describe("sanitizeForAudit / uuidish (units)", () => {
  it("bounds strings, caps depth, filters non-uuids", () => {
    const long = sanitizeForAudit("a".repeat(600)) as string;
    expect(long).toContain("[truncated 100 chars]");
    const deep = sanitizeForAudit({ a: { b: { c: { d: { e: "too deep" } } } } }) as never;
    expect(JSON.stringify(deep)).toContain("depth capped");
    expect(uuidish(randomUUID())).not.toBeNull();
    expect(uuidish("not-a-uuid")).toBeNull();
    expect(uuidish(42)).toBeNull();
  });
});

describe("notifications read side (caller-scoped)", () => {
  async function seedNotification(agencyId: string, userId: string, title: string) {
    const [n] = await db
      .insert(notifications)
      .values({ agencyId, userId, type: "system", title })
      .returning();
    return n!;
  }

  it("lists only the caller's rows; unreadOnly filters; counts unread", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    userIds.push(alice.id, bob.id);

    await seedNotification(agency.id, alice.id, "for alice 1");
    const read = await seedNotification(agency.id, alice.id, "for alice 2");
    await seedNotification(agency.id, bob.id, "for bob");
    await markRead({ agencyId: agency.id, userId: alice.id, id: read.id });

    const aliceAll = await listNotifications({ agencyId: agency.id, userId: alice.id });
    expect(aliceAll.map((n) => n.title).sort()).toEqual(["for alice 1", "for alice 2"]);

    const aliceUnread = await listNotifications({ agencyId: agency.id, userId: alice.id, unreadOnly: true });
    expect(aliceUnread.map((n) => n.title)).toEqual(["for alice 1"]);

    expect((await unreadCount({ agencyId: agency.id, userId: alice.id })).count).toBe(1);
    expect((await unreadCount({ agencyId: agency.id, userId: bob.id })).count).toBe(1);
  });

  it("markRead is idempotent and refuses other users' rows; markAllRead clears", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    userIds.push(alice.id, bob.id);

    const n = await seedNotification(agency.id, alice.id, "one");
    const first = await markRead({ agencyId: agency.id, userId: alice.id, id: n.id });
    expect(first.readAt).not.toBeNull();
    const second = await markRead({ agencyId: agency.id, userId: alice.id, id: n.id });
    expect(second.readAt?.getTime()).toBe(first.readAt?.getTime()); // original preserved

    // Bob can't mark Alice's.
    const n2 = await seedNotification(agency.id, alice.id, "two");
    await expect(
      markRead({ agencyId: agency.id, userId: bob.id, id: n2.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await seedNotification(agency.id, alice.id, "three");
    await markAllRead({ agencyId: agency.id, userId: alice.id });
    expect((await unreadCount({ agencyId: agency.id, userId: alice.id })).count).toBe(0);
  });
});
