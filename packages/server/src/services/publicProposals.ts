import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { agencies, agencySettings, db, proposalLineItems, proposals } from "@ojaven/db";
import { txDb } from "@ojaven/db/transactionClient";
import type { RespondToProposalInput } from "@ojaven/shared";
import { lockKey } from "./agencyLock";

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Proposal not found." });

/**
 * Resolve a proposal by its public token, uniformly. A token only "activates"
 * on send, so drafts are unreachable; soft-deleted are unreachable. Anything
 * that doesn't resolve to a live, non-draft proposal returns the SAME
 * NOT_FOUND — no enumeration signal (draft vs deleted vs wrong-token are
 * indistinguishable). The 256-bit token makes guessing infeasible anyway.
 */
async function resolveByToken(token: string) {
  const [row] = await db
    .select({ id: proposals.id, status: proposals.status })
    .from(proposals)
    .where(
      and(
        eq(proposals.publicToken, token),
        isNull(proposals.deletedAt),
        ne(proposals.status, "draft")
      )
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * Public display payload — ONLY this one proposal's content + the agency's own
 * branding. No client PII beyond what the agency wrote into bodyHtml, no other
 * proposals, no agency internals. The token is never echoed back.
 */
export async function getProposalByToken(token: string) {
  const [row] = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      bodyHtml: proposals.bodyHtml,
      value: proposals.value,
      status: proposals.status,
      signedByName: proposals.signedByName,
      respondedAt: proposals.respondedAt,
      sentAt: proposals.sentAt,
      agencyName: agencies.name,
      logoUrl: agencySettings.logoUrl,
      primaryColor: agencySettings.primaryColor,
    })
    .from(proposals)
    .innerJoin(agencies, eq(agencies.id, proposals.agencyId))
    .leftJoin(agencySettings, eq(agencySettings.agencyId, proposals.agencyId))
    .where(
      and(
        eq(proposals.publicToken, token),
        isNull(proposals.deletedAt),
        ne(proposals.status, "draft")
      )
    )
    .limit(1);
  if (!row) throw notFound();

  const lineItems = await db
    .select({
      description: proposalLineItems.description,
      quantity: proposalLineItems.quantity,
      unitPrice: proposalLineItems.unitPrice,
      amount: proposalLineItems.amount,
    })
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, row.id))
    .orderBy(asc(proposalLineItems.sortOrder));

  // id was only needed to fetch line items — don't leak it to the public payload.
  const { id: _id, ...display } = row;
  return { ...display, lineItems };
}

/** Best-effort view tracking: sent -> viewed (once). Idempotent. */
export async function markProposalViewed(token: string) {
  const found = await resolveByToken(token);
  if (found.status === "sent") {
    await db
      .update(proposals)
      .set({ status: "viewed", viewedAt: new Date() })
      .where(and(eq(proposals.id, found.id), eq(proposals.status, "sent")));
  }
  return { ok: true as const };
}

/**
 * Accept or decline. Advisory-locked on the proposal so two concurrent accepts
 * serialize: the first commits 'accepted', the second re-reads that state and
 * is refused — there can never be two acceptances. Only sent/viewed can respond;
 * anything else (already responded, expired) is a readable CONFLICT.
 */
export async function respondToProposal(input: RespondToProposalInput) {
  const found = await resolveByToken(input.token); // NOT_FOUND for draft/deleted/wrong

  return txDb.transaction(async (tx) => {
    await lockKey(tx, "proposal-respond", found.id);

    const [current] = await tx
      .select({ status: proposals.status })
      .from(proposals)
      .where(eq(proposals.id, found.id))
      .limit(1);

    if (!current || (current.status !== "sent" && current.status !== "viewed")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This proposal has already been responded to.",
      });
    }

    const [updated] = await tx
      .update(proposals)
      .set({
        status: input.decision === "accept" ? "accepted" : "declined",
        respondedAt: new Date(),
        signedByName: input.decision === "accept" ? input.signedByName! : input.signedByName || null,
      })
      .where(eq(proposals.id, found.id))
      .returning({
        status: proposals.status,
        respondedAt: proposals.respondedAt,
        signedByName: proposals.signedByName,
      });
    return updated;
  });
}
