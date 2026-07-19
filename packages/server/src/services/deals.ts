import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { clients, db, deals, pipelines, pipelineStages } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { CreateDealInput, UpdateDealInput } from "@ojaven/shared";
import { lockAgency } from "./agencyLock";

const money = (value: number) => value.toFixed(2);

/**
 * Every deal read joins clients with deletedAt IS NULL — the approved
 * client-soft-delete semantics: a soft-deleted client's deals vanish from
 * all views without a single write, and restoring the client restores
 * visibility for free (zero-mutation restore).
 */
const activeDealJoin = (agencyId: string) =>
  and(eq(deals.agencyId, agencyId), isNull(deals.deletedAt), isNull(clients.deletedAt));

export async function listDeals(params: { agencyId: string; pipelineId?: string }) {
  const where = params.pipelineId
    ? and(activeDealJoin(params.agencyId), eq(deals.pipelineId, params.pipelineId))
    : activeDealJoin(params.agencyId);

  return db
    .select({
      id: deals.id,
      name: deals.name,
      clientId: deals.clientId,
      clientName: clients.name,
      pipelineId: deals.pipelineId,
      stageId: deals.stageId,
      ownerId: deals.ownerId,
      value: deals.value,
      mrr: deals.mrr,
      closeProbability: deals.closeProbability,
      status: deals.status,
      expectedCloseDate: deals.expectedCloseDate,
      closedAt: deals.closedAt,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .where(where)
    .orderBy(desc(deals.createdAt));
}

export async function getDealById(params: { agencyId: string; id: string }) {
  const [deal] = await db
    .select({
      id: deals.id,
      name: deals.name,
      clientId: deals.clientId,
      clientName: clients.name,
      pipelineId: deals.pipelineId,
      stageId: deals.stageId,
      ownerId: deals.ownerId,
      value: deals.value,
      mrr: deals.mrr,
      closeProbability: deals.closeProbability,
      status: deals.status,
      expectedCloseDate: deals.expectedCloseDate,
      closedAt: deals.closedAt,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .where(and(activeDealJoin(params.agencyId), eq(deals.id, params.id)))
    .limit(1);

  if (!deal) {
    // Same shape as clients.byId: other-agency, soft-deleted, and
    // soft-deleted-client cases are all indistinguishable from absent.
    throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });
  }
  return deal;
}

export async function createDeal(params: {
  agencyId: string;
  actorUserId: string;
  input: CreateDealInput;
}) {
  const { input } = params;

  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    // Client must be active — creating a deal on a soft-deleted client is
    // refused with the same opaque NOT_FOUND as reads.
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.agencyId, params.agencyId),
          isNull(clients.deletedAt)
        )
      )
      .limit(1);
    if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });

    // Resolve pipeline: explicit id, else the default, else the first active.
    let pipelineId = input.pipelineId;
    if (pipelineId) {
      const [pipeline] = await tx
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(
          and(
            eq(pipelines.id, pipelineId),
            eq(pipelines.agencyId, params.agencyId),
            isNull(pipelines.deletedAt)
          )
        )
        .limit(1);
      if (!pipeline) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found." });
    } else {
      const [pipeline] = await tx
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.agencyId, params.agencyId), isNull(pipelines.deletedAt)))
        .orderBy(desc(pipelines.isDefault), asc(pipelines.sortOrder), asc(pipelines.createdAt))
        .limit(1);
      if (!pipeline) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No pipeline set up yet — create one first.",
        });
      }
      pipelineId = pipeline.id;
    }

    // Resolve stage: explicit id (must belong to the pipeline), else first.
    let stageId = input.stageId;
    if (stageId) {
      const [stage] = await tx
        .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.id, stageId),
            eq(pipelineStages.agencyId, params.agencyId),
            isNull(pipelineStages.deletedAt)
          )
        )
        .limit(1);
      if (!stage) throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found." });
      if (stage.pipelineId !== pipelineId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That stage belongs to a different pipeline.",
        });
      }
    } else {
      const [stage] = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.deletedAt)))
        .orderBy(asc(pipelineStages.sortOrder))
        .limit(1);
      if (!stage) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "That pipeline has no stages yet — add one first.",
        });
      }
      stageId = stage.id;
    }

    const [deal] = await tx
      .insert(deals)
      .values({
        agencyId: params.agencyId,
        clientId: input.clientId,
        pipelineId,
        stageId,
        ownerId: params.actorUserId,
        name: input.name,
        value: money(input.value ?? 0),
        mrr: input.mrr != null ? money(input.mrr) : null,
        closeProbability: input.closeProbability ?? 0,
        expectedCloseDate: input.expectedCloseDate ?? null,
      })
      .returning();
    return deal;
  });
}

export async function updateDeal(params: { agencyId: string; input: UpdateDealInput }) {
  const { input } = params;

  // Presence-based: undefined = not sent. Explicit null clears nullables.
  const setValues: Partial<typeof deals.$inferInsert> = {};
  if (input.name !== undefined) setValues.name = input.name;
  if (input.value !== undefined) setValues.value = money(input.value);
  if (input.mrr !== undefined) setValues.mrr = input.mrr != null ? money(input.mrr) : null;
  if (input.closeProbability !== undefined) setValues.closeProbability = input.closeProbability;
  if (input.expectedCloseDate !== undefined) setValues.expectedCloseDate = input.expectedCloseDate;

  if (Object.keys(setValues).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [updated] = await db
    .update(deals)
    .set(setValues)
    .where(
      and(eq(deals.id, input.id), eq(deals.agencyId, params.agencyId), isNull(deals.deletedAt))
    )
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });
  return updated;
}

/**
 * Kanban drag primitive. Cross-pipeline moves are a KNOWN DEFERRED
 * feature (agencies do move deals between funnels — this will come back);
 * v1 refuses with a clear error, never a silent no-op.
 */
export async function moveDealStage(params: { agencyId: string; id: string; stageId: string }) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const [deal] = await tx
      .select({ id: deals.id, pipelineId: deals.pipelineId })
      .from(deals)
      .where(
        and(eq(deals.id, params.id), eq(deals.agencyId, params.agencyId), isNull(deals.deletedAt))
      )
      .limit(1);
    if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });

    const [stage] = await tx
      .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.id, params.stageId),
          eq(pipelineStages.agencyId, params.agencyId),
          isNull(pipelineStages.deletedAt)
        )
      )
      .limit(1);
    if (!stage) throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found." });

    if (stage.pipelineId !== deal.pipelineId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This deal belongs to a different pipeline — moving deals between pipelines isn't supported yet.",
      });
    }

    const [moved] = await tx
      .update(deals)
      .set({ stageId: stage.id })
      .where(eq(deals.id, deal.id))
      .returning();
    return moved;
  });
}

export async function setDealStatus(params: {
  agencyId: string;
  id: string;
  status: "open" | "won" | "lost";
}) {
  const [updated] = await db
    .update(deals)
    .set({
      status: params.status,
      closedAt: params.status === "open" ? null : new Date(),
    })
    .where(
      and(eq(deals.id, params.id), eq(deals.agencyId, params.agencyId), isNull(deals.deletedAt))
    )
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });
  return updated;
}

export async function deleteDeal(params: { agencyId: string; id: string }) {
  const [removed] = await db
    .update(deals)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(deals.id, params.id), eq(deals.agencyId, params.agencyId), isNull(deals.deletedAt))
    )
    .returning({ id: deals.id });
  if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found." });
  return removed;
}
