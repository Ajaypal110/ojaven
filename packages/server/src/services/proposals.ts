import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { deals, db, proposalLineItems, proposals } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { CreateProposalInput, ProposalStatus, UpdateProposalInput } from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);

/**
 * bodyHtml is authored by a trusted agency user but rendered to an UNTRUSTED
 * public viewer on /p/[token] — a stored-XSS surface. Sanitize server-side at
 * write to an allowlist (no script/style/on* handlers, safe link schemes,
 * links forced to rel=noopener). This is the real vulnerability here, not the
 * token.
 */
export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote", "a", "hr",
      "table", "thead", "tbody", "tr", "td", "th",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
    },
  });
}

function lineItemRows(agencyId: string, proposalId: string, items: CreateProposalInput["lineItems"]) {
  return (items ?? []).map((li, i) => ({
    agencyId,
    proposalId,
    description: li.description,
    quantity: money(li.quantity),
    unitPrice: money(li.unitPrice),
    amount: money(li.quantity * li.unitPrice),
    sortOrder: i,
  }));
}

const sumValue = (items: CreateProposalInput["lineItems"]) =>
  money((items ?? []).reduce((s, li) => s + li.quantity * li.unitPrice, 0));

async function assertDealInAgency(dbc: typeof db | Tx, agencyId: string, dealId: string) {
  const [deal] = await dbc
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.agencyId, agencyId), isNull(deals.deletedAt)))
    .limit(1);
  if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });
}

async function loadLiveProposal(dbc: typeof db | Tx, agencyId: string, id: string) {
  const [row] = await dbc
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.agencyId, agencyId), isNull(proposals.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found." });
  return row;
}

export async function listProposals(params: {
  agencyId: string;
  clientId?: string;
  status?: ProposalStatus;
}) {
  const conds = [eq(proposals.agencyId, params.agencyId), isNull(proposals.deletedAt)];
  if (params.clientId) conds.push(eq(proposals.clientId, params.clientId));
  if (params.status) conds.push(eq(proposals.status, params.status));
  return db
    .select({
      id: proposals.id,
      clientId: proposals.clientId,
      title: proposals.title,
      value: proposals.value,
      status: proposals.status,
      publicToken: proposals.publicToken, // agency-owned; the shareable link
      signedByName: proposals.signedByName,
      sentAt: proposals.sentAt,
      respondedAt: proposals.respondedAt,
      createdAt: proposals.createdAt,
    })
    .from(proposals)
    .where(and(...conds))
    .orderBy(desc(proposals.createdAt));
}

export async function getProposalById(params: { agencyId: string; id: string }) {
  const proposal = await loadLiveProposal(db, params.agencyId, params.id);
  const items = await db
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.sortOrder));
  return { ...proposal, lineItems: items };
}

export async function createProposal(params: {
  agencyId: string;
  actorUserId: string;
  input: CreateProposalInput;
}) {
  const { agencyId, actorUserId, input } = params;
  await assertEntityLive(db, agencyId, "client", input.clientId);
  if (input.dealId) await assertDealInAgency(db, agencyId, input.dealId);

  return txDb.transaction(async (tx) => {
    const [proposal] = await tx
      .insert(proposals)
      .values({
        agencyId,
        clientId: input.clientId,
        dealId: input.dealId ?? null,
        createdById: actorUserId,
        title: input.title,
        bodyHtml: sanitizeBody(input.bodyHtml ?? ""),
        value: sumValue(input.lineItems),
        // status defaults to draft; no token until send.
      })
      .returning();

    const rows = lineItemRows(agencyId, proposal!.id, input.lineItems);
    if (rows.length) await tx.insert(proposalLineItems).values(rows);

    return proposal!;
  });
}

/** Draft-only. Once sent, a proposal is locked (the client saw/accepted a version). */
export async function updateProposal(params: { agencyId: string; input: UpdateProposalInput }) {
  const { agencyId, input } = params;

  return txDb.transaction(async (tx) => {
    const proposal = await loadLiveProposal(tx, agencyId, input.id);
    if (proposal.status !== "draft") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only draft proposals can be edited. Send creates a locked version.",
      });
    }

    const set: Partial<typeof proposals.$inferInsert> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.bodyHtml !== undefined) set.bodyHtml = sanitizeBody(input.bodyHtml);
    if (input.dealId !== undefined) {
      if (input.dealId) await assertDealInAgency(tx, agencyId, input.dealId);
      set.dealId = input.dealId;
    }
    if (input.lineItems !== undefined) {
      // Replace-all + recompute the denormalized value.
      await tx.delete(proposalLineItems).where(eq(proposalLineItems.proposalId, proposal.id));
      const rows = lineItemRows(agencyId, proposal.id, input.lineItems);
      if (rows.length) await tx.insert(proposalLineItems).values(rows);
      set.value = sumValue(input.lineItems);
    }

    if (Object.keys(set).length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
    }

    const [updated] = await tx
      .update(proposals)
      .set(set)
      .where(eq(proposals.id, proposal.id))
      .returning();
    return updated;
  });
}

const generateToken = () => randomBytes(32).toString("base64url"); // 256-bit, URL-safe

/** Mint the public token and move draft -> sent. Idempotent-ish: re-send keeps the token. */
export async function sendProposal(params: { agencyId: string; id: string }) {
  const { agencyId, id } = params;
  const proposal = await loadLiveProposal(db, agencyId, id);
  if (proposal.status !== "draft") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This proposal has already been sent." });
  }
  // Client must still be live at send time.
  await assertEntityLive(db, agencyId, "client", proposal.clientId);

  // Unique token; retry on the astronomically-unlikely collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [updated] = await db
        .update(proposals)
        .set({ status: "sent", sentAt: new Date(), publicToken: generateToken() })
        .where(and(eq(proposals.id, id), eq(proposals.status, "draft")))
        .returning();
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "This proposal has already been sent." });
      return updated;
    } catch (err) {
      const isUnique = Boolean(
        err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505"
      );
      if (isUnique && attempt < 4) continue;
      throw err;
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not generate a proposal link." });
}

export async function deleteProposal(params: { agencyId: string; id: string }) {
  const { agencyId, id } = params;
  const proposal = await loadLiveProposal(db, agencyId, id);
  if (proposal.status === "accepted") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An accepted proposal can't be deleted — it's the basis for billing.",
    });
  }
  const [removed] = await db
    .update(proposals)
    .set({ deletedAt: new Date() })
    .where(and(eq(proposals.id, id), eq(proposals.agencyId, agencyId), isNull(proposals.deletedAt)))
    .returning({ id: proposals.id });
  return removed;
}
