import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients, db, deals, proposals } from "@ojaven/db";
import { respondToProposalSchema, proposalLineItemSchema } from "@ojaven/shared";
import {
  createProposal,
  deleteProposal,
  getProposalById,
  listProposals,
  sanitizeBody,
  sendProposal,
  updateProposal,
} from "../src/services/proposals";
import {
  getProposalByToken,
  markProposalViewed,
  respondToProposal,
} from "../src/services/publicProposals";
import { rateLimitIdentifier } from "../src/middleware/rateLimit";
import { ensureMembership } from "../src/services/teamMembership";
import { ensureDefaultPipeline, listPipelines } from "../src/services/pipeline";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];
afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

async function freshAgency() {
  const a = await seedAgency();
  agencyIds.push(a.id);
  return a;
}
async function member(agencyId: string, label = "u") {
  const u = await seedUser(label);
  userIds.push(u.id);
  await ensureMembership({ agencyId, userId: u.id });
  return u.id;
}
async function seedClient(agencyId: string, name = "Acme Co") {
  const [c] = await db.insert(clients).values({ agencyId, name }).returning();
  return c!;
}
async function seedDeal(agencyId: string, clientId: string) {
  const { pipeline } = await ensureDefaultPipeline(agencyId);
  const [withStages] = await listPipelines(agencyId);
  const [d] = await db
    .insert(deals)
    .values({ agencyId, clientId, pipelineId: pipeline.id, stageId: withStages!.stages[0]!.id, name: "Deal" })
    .returning();
  return d!;
}
const items = [
  { description: "Setup", quantity: 2, unitPrice: 100 },
  { description: "Monthly", quantity: 1, unitPrice: 50 },
];

describe("createProposal — totals, sanitization, guards", () => {
  it("computes value from line items and stores computed amounts", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "Q3", lineItems: items } });
    expect(Number(p.value)).toBe(250);

    const full = await getProposalById({ agencyId: a.id, id: p.id });
    expect(full.lineItems.map((li) => Number(li.amount))).toEqual([200, 50]);
    expect(full.status).toBe("draft");
  });

  it("sanitizes bodyHtml (strips script + javascript: URLs)", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const dirty = `<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>`;
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "T", bodyHtml: dirty } });
    const full = await getProposalById({ agencyId: a.id, id: p.id });
    expect(full.bodyHtml).toContain("<p>Hello</p>");
    expect(full.bodyHtml.toLowerCase()).not.toContain("<script");
    expect(full.bodyHtml.toLowerCase()).not.toContain("javascript:");
  });

  it("rejects soft-deleted / cross-agency client and foreign deal", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const uid = await member(a.id);

    const dead = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, dead.id));
    await expect(createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: dead.id, title: "T" } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const bClient = await seedClient(b.id);
    await expect(createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: bClient.id, title: "T" } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const client = await seedClient(a.id);
    const bDeal = await seedDeal(b.id, bClient.id);
    await expect(createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "T", dealId: bDeal.id } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateProposal — draft-only, recompute", () => {
  it("edits a draft and recomputes value; refuses once sent", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "T", lineItems: items } });

    const upd = await updateProposal({ agencyId: a.id, input: { id: p.id, title: "T2", lineItems: [{ description: "One", quantity: 3, unitPrice: 100 }] } });
    expect(upd.title).toBe("T2");
    expect(Number(upd.value)).toBe(300); // recomputed

    await sendProposal({ agencyId: a.id, id: p.id });
    await expect(updateProposal({ agencyId: a.id, input: { id: p.id, title: "nope" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("sendProposal — token minting", () => {
  it("draft -> sent with a unique 256-bit token; re-send refused", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p1 = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "T1" } });
    const p2 = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "T2" } });

    const s1 = await sendProposal({ agencyId: a.id, id: p1.id });
    const s2 = await sendProposal({ agencyId: a.id, id: p2.id });
    expect(s1.status).toBe("sent");
    expect(s1.sentAt).not.toBeNull();
    expect(s1.publicToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(s1.publicToken).not.toBe(s2.publicToken); // unique

    await expect(sendProposal({ agencyId: a.id, id: p1.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("deleteProposal — soft, accepted protected", () => {
  it("soft-deletes a draft, refuses an accepted one", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);

    const draft = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "D" } });
    await deleteProposal({ agencyId: a.id, id: draft.id });
    expect((await listProposals({ agencyId: a.id })).find((p) => p.id === draft.id)).toBeUndefined();

    const accepted = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "A" } });
    const sent = await sendProposal({ agencyId: a.id, id: accepted.id });
    await respondToProposal({ token: sent.publicToken!, decision: "accept", signedByName: "Jane Client" });
    await expect(deleteProposal({ agencyId: a.id, id: accepted.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("public token access — no enumeration signal", () => {
  it("draft is unreachable by token; wrong token is uniform NOT_FOUND", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);

    // A draft never gets a token; force one on it to prove the status guard.
    const draft = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "Draft" } });
    await db.update(proposals).set({ publicToken: "draftleak-token-000000000000000000" }).where(eq(proposals.id, draft.id));
    await expect(getProposalByToken("draftleak-token-000000000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Wrong token -> same NOT_FOUND.
    await expect(getProposalByToken("this-token-does-not-exist-anywhere-xyz")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a sent proposal is viewable by token, and the payload leaks no id/token/clientId", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "Live", bodyHtml: "<p>Scope</p>", lineItems: items } });
    const sent = await sendProposal({ agencyId: a.id, id: p.id });

    const view = await getProposalByToken(sent.publicToken!);
    expect(view.title).toBe("Live");
    expect(view.agencyName).toBe(a.name);
    expect(Number(view.value)).toBe(250);
    expect(view.lineItems).toHaveLength(2);
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("publicToken");
    expect(view).not.toHaveProperty("clientId");
  });

  it("soft-deleted proposal becomes unreachable by its token", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "Gone" } });
    const sent = await sendProposal({ agencyId: a.id, id: p.id });
    await db.update(proposals).set({ deletedAt: new Date() }).where(eq(proposals.id, p.id));
    await expect(getProposalByToken(sent.publicToken!)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("markViewed + respond state machine", () => {
  it("sent -> viewed (idempotent); accept records signature; decline works", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);

    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "V" } });
    const sent = await sendProposal({ agencyId: a.id, id: p.id });
    const token = sent.publicToken!;

    await markProposalViewed(token);
    let [row] = await db.select().from(proposals).where(eq(proposals.id, p.id));
    expect(row?.status).toBe("viewed");
    expect(row?.viewedAt).not.toBeNull();
    const firstViewedAt = row?.viewedAt;
    await markProposalViewed(token); // idempotent
    [row] = await db.select().from(proposals).where(eq(proposals.id, p.id));
    expect(row?.viewedAt?.getTime()).toBe(firstViewedAt?.getTime());

    const accepted = await respondToProposal({ token, decision: "accept", signedByName: "Grace Client" });
    expect(accepted.status).toBe("accepted");
    expect(accepted.signedByName).toBe("Grace Client");
    // Responding again -> CONFLICT.
    await expect(respondToProposal({ token, decision: "decline" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("CONCURRENT ACCEPT: two accepts race -> exactly one accepted, the other CONFLICT", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const p = await createProposal({ agencyId: a.id, actorUserId: uid, input: { clientId: client.id, title: "Race" } });
    const sent = await sendProposal({ agencyId: a.id, id: p.id });
    const token = sent.publicToken!;

    const results = await Promise.allSettled([
      respondToProposal({ token, decision: "accept", signedByName: "First" }),
      respondToProposal({ token, decision: "accept", signedByName: "Second" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    const [row] = await db.select().from(proposals).where(eq(proposals.id, p.id));
    expect(row?.status).toBe("accepted"); // never two acceptances
  });

  it("respond to a wrong/draft token -> NOT_FOUND", async () => {
    await expect(respondToProposal({ token: "nope-nope-nope-nope-nope-nope", decision: "decline" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Zod + sanitize + rate-limit keying (units)", () => {
  it("respond schema requires signedByName only on accept", () => {
    const base = { token: "a".repeat(30) };
    expect(respondToProposalSchema.safeParse({ ...base, decision: "accept" }).success).toBe(false);
    expect(respondToProposalSchema.safeParse({ ...base, decision: "accept", signedByName: "X" }).success).toBe(true);
    expect(respondToProposalSchema.safeParse({ ...base, decision: "decline" }).success).toBe(true);
  });
  it("line item schema bounds quantity/price", () => {
    expect(proposalLineItemSchema.safeParse({ description: "d", quantity: 0, unitPrice: 1 }).success).toBe(false);
    expect(proposalLineItemSchema.safeParse({ description: "d", quantity: 1, unitPrice: -1 }).success).toBe(false);
    expect(proposalLineItemSchema.safeParse({ description: "d", quantity: 1, unitPrice: 0 }).success).toBe(true);
  });
  it("sanitizeBody strips dangerous content, keeps formatting", () => {
    expect(sanitizeBody("<b>ok</b><script>x</script>")).toBe("<b>ok</b>");
    expect(sanitizeBody('<img src=x onerror=alert(1)>')).not.toContain("onerror");
  });
  it("rate-limit key: per-user when authed, per-IP when anonymous, else 'anonymous'", () => {
    expect(rateLimitIdentifier({ userId: "user_1", ip: "1.2.3.4" })).toBe("user_1");
    expect(rateLimitIdentifier({ userId: null, ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
    expect(rateLimitIdentifier({ userId: null, ip: null })).toBe("anonymous");
  });
});
