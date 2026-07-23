import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { contentItems, db } from "@ojaven/db";
import type {
  ContentStatus,
  CreateContentInput,
  ListContentInput,
  ReviewContentInput,
  UpdateContentInput,
} from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";

/**
 * State machine:
 *   draft ──submit──► in_review ──review(approve)──► approved ──publish──► published
 *     ▲                   │ review(reject, note?)
 *     └──── edit+submit ── rejected
 *
 * Editable only in draft|rejected. in_review is locked (content must not shift
 * under the reviewer); approved is locked (what was approved is what publishes
 * — the frozen-version principle of sent proposals / issued invoices);
 * published is locked. No un-approve/un-publish in A8 (KNOWN_ITEMS if it bites).
 *
 * Transitions are compare-and-swap UPDATEs (WHERE status = expected), so two
 * concurrent reviews/submits/publishes can't both win — no advisory lock
 * needed for a single-row status CAS.
 */

async function loadContent(agencyId: string, id: string) {
  const [row] = await db
    .select()
    .from(contentItems)
    .where(
      and(eq(contentItems.id, id), eq(contentItems.agencyId, agencyId), isNull(contentItems.deletedAt))
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Content not found." });
  return row;
}

/** CAS transition; on miss, distinguishes gone (NOT_FOUND) from wrong-state (CONFLICT). */
async function transition(
  agencyId: string,
  id: string,
  from: ContentStatus[],
  set: Partial<typeof contentItems.$inferInsert>,
  wrongStateMessage: (status: string) => string
) {
  for (const expected of from) {
    const [updated] = await db
      .update(contentItems)
      .set(set)
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.agencyId, agencyId),
          isNull(contentItems.deletedAt),
          eq(contentItems.status, expected)
        )
      )
      .returning();
    if (updated) return updated;
  }
  const current = await loadContent(agencyId, id); // throws NOT_FOUND if gone
  throw new TRPCError({ code: "CONFLICT", message: wrongStateMessage(current.status) });
}

export async function listContent(params: { agencyId: string } & ListContentInput) {
  const conds = [eq(contentItems.agencyId, params.agencyId), isNull(contentItems.deletedAt)];
  if (params.clientId) conds.push(eq(contentItems.clientId, params.clientId));
  if (params.status) conds.push(eq(contentItems.status, params.status));
  if (params.contentType) conds.push(eq(contentItems.contentType, params.contentType));
  return db
    .select()
    .from(contentItems)
    .where(and(...conds))
    .orderBy(desc(contentItems.createdAt));
}

export async function getContentById(params: { agencyId: string; id: string }) {
  return loadContent(params.agencyId, params.id);
}

export async function createContent(params: {
  agencyId: string;
  actorUserId: string;
  input: CreateContentInput;
}) {
  const { agencyId, actorUserId, input } = params;
  await assertEntityLive(db, agencyId, "client", input.clientId);
  const [row] = await db
    .insert(contentItems)
    .values({
      agencyId,
      clientId: input.clientId,
      title: input.title,
      body: input.body || null,
      contentType: input.contentType,
      createdById: actorUserId,
      // status defaults to draft
    })
    .returning();
  return row;
}

/** Editable in draft|rejected only. */
export async function updateContent(params: { agencyId: string; input: UpdateContentInput }) {
  const { agencyId, input } = params;
  const current = await loadContent(agencyId, input.id);
  if (current.status !== "draft" && current.status !== "rejected") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${current.status === "in_review" ? "Content under review" : `${current.status[0]!.toUpperCase()}${current.status.slice(1)} content`} is locked — only drafts and rejected items can be edited.`,
    });
  }

  const set: Partial<typeof contentItems.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.body !== undefined) set.body = input.body || null;
  if (input.contentType !== undefined) set.contentType = input.contentType;
  if (Object.keys(set).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [updated] = await db
    .update(contentItems)
    .set(set)
    .where(
      and(
        eq(contentItems.id, input.id),
        eq(contentItems.agencyId, agencyId),
        isNull(contentItems.deletedAt)
      )
    )
    .returning();
  return updated;
}

/** draft|rejected -> in_review. The rejection's reviewNote stays until the next verdict overwrites it. */
export async function submitContent(params: { agencyId: string; id: string }) {
  return transition(
    params.agencyId,
    params.id,
    ["draft", "rejected"],
    { status: "in_review" },
    (s) => `Only drafts and rejected items can be submitted (this one is ${s}).`
  );
}

/**
 * in_review -> approved|rejected. Actor-agnostic on purpose: today the actor
 * is a team member (internal QA, or transcribing the client's emailed
 * decision); at C1 the portal writes these same fields as the client_user.
 * Self-review is allowed — the role gate is the control (a solo agency must
 * not deadlock on submitter != reviewer).
 */
export async function reviewContent(params: {
  agencyId: string;
  actorUserId: string;
  input: ReviewContentInput;
}) {
  const { agencyId, actorUserId, input } = params;
  return transition(
    agencyId,
    input.id,
    ["in_review"],
    {
      status: input.decision === "approve" ? "approved" : "rejected",
      reviewedById: actorUserId,
      reviewedAt: new Date(),
      reviewNote: input.note || null,
    },
    (s) => `Only content in review can be ${input.decision}d (this one is ${s}).`
  );
}

/** approved -> published. Mechanical — the authority gate was the approval. */
export async function publishContent(params: { agencyId: string; id: string }) {
  return transition(
    params.agencyId,
    params.id,
    ["approved"],
    { status: "published" },
    (s) => `Only approved content can be published (this one is ${s}).`
  );
}

export async function deleteContent(params: { agencyId: string; id: string }) {
  const [removed] = await db
    .update(contentItems)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(contentItems.id, params.id),
        eq(contentItems.agencyId, params.agencyId),
        isNull(contentItems.deletedAt)
      )
    )
    .returning({ id: contentItems.id });
  if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Content not found." });
  return removed;
}
