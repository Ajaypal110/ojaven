import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, deals, pipelines, pipelineStages } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import { lockAgency } from "./agencyLock";

const DEFAULT_PIPELINE_NAME = "Sales";
const DEFAULT_STAGES: Array<{ name: string; closeProbability: number }> = [
  { name: "Lead", closeProbability: 10 },
  { name: "Qualified", closeProbability: 35 },
  { name: "Proposal sent", closeProbability: 60 },
  { name: "Negotiation", closeProbability: 80 },
];

async function activePipelineById(tx: Tx, agencyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.agencyId, agencyId), isNull(pipelines.deletedAt)))
    .limit(1);
  return row;
}

async function activeStageById(tx: Tx, agencyId: string, stageId: string) {
  const [row] = await tx
    .select()
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.id, stageId),
        eq(pipelineStages.agencyId, agencyId),
        isNull(pipelineStages.deletedAt)
      )
    )
    .limit(1);
  return row;
}

/** Pipelines with their active stages, stage-ordered. */
export async function listPipelines(agencyId: string) {
  const pipelineRows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.agencyId, agencyId), isNull(pipelines.deletedAt)))
    .orderBy(asc(pipelines.sortOrder), asc(pipelines.createdAt));

  const stageRows = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.agencyId, agencyId), isNull(pipelineStages.deletedAt)))
    .orderBy(asc(pipelineStages.sortOrder));

  return pipelineRows.map((pipeline) => ({
    ...pipeline,
    stages: stageRows.filter((stage) => stage.pipelineId === pipeline.id),
  }));
}

/**
 * Idempotent default seed — advisory-locked so concurrent first visits
 * can't double-seed (same pattern as membership bootstrap). Explicitly
 * invoked from the UI's empty state, never a middleware side effect.
 */
export async function ensureDefaultPipeline(agencyId: string) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, agencyId);

    const [existing] = await tx
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.agencyId, agencyId), isNull(pipelines.deletedAt)))
      .limit(1);
    if (existing) return { pipeline: existing, created: false };

    const [pipeline] = await tx
      .insert(pipelines)
      .values({ agencyId, name: DEFAULT_PIPELINE_NAME, isDefault: true })
      .returning();
    if (!pipeline) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Seed failed." });
    }

    await tx.insert(pipelineStages).values(
      DEFAULT_STAGES.map((stage, index) => ({
        agencyId,
        pipelineId: pipeline.id,
        name: stage.name,
        closeProbability: stage.closeProbability,
        sortOrder: index,
      }))
    );

    return { pipeline, created: true };
  });
}

export async function createPipeline(params: { agencyId: string; name: string }) {
  const [pipeline] = await db
    .insert(pipelines)
    .values({ agencyId: params.agencyId, name: params.name })
    .returning();
  return pipeline;
}

export async function renamePipeline(params: { agencyId: string; id: string; name: string }) {
  const [updated] = await db
    .update(pipelines)
    .set({ name: params.name })
    .where(
      and(
        eq(pipelines.id, params.id),
        eq(pipelines.agencyId, params.agencyId),
        isNull(pipelines.deletedAt)
      )
    )
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found." });
  return updated;
}

/** Archive (soft-delete). Guard: refuses while the pipeline holds open, non-deleted deals. */
export async function archivePipeline(params: { agencyId: string; id: string }) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const pipeline = await activePipelineById(tx, params.agencyId, params.id);
    if (!pipeline) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found." });

    const [openDeal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          eq(deals.pipelineId, pipeline.id),
          eq(deals.status, "open"),
          isNull(deals.deletedAt)
        )
      )
      .limit(1);
    if (openDeal) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This pipeline still has open deals — close or move them first.",
      });
    }

    const [archived] = await tx
      .update(pipelines)
      .set({ deletedAt: new Date() })
      .where(eq(pipelines.id, pipeline.id))
      .returning({ id: pipelines.id });
    return archived;
  });
}

export async function createStage(params: {
  agencyId: string;
  pipelineId: string;
  name: string;
  closeProbability?: number;
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const pipeline = await activePipelineById(tx, params.agencyId, params.pipelineId);
    if (!pipeline) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found." });

    const [maxRow] = await tx
      .select({ max: sql<number | null>`max(${pipelineStages.sortOrder})` })
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipeline.id));

    const [stage] = await tx
      .insert(pipelineStages)
      .values({
        agencyId: params.agencyId,
        pipelineId: pipeline.id,
        name: params.name,
        closeProbability: params.closeProbability ?? 0,
        sortOrder: (maxRow?.max ?? -1) + 1,
      })
      .returning();
    return stage;
  });
}

export async function updateStage(params: {
  agencyId: string;
  stageId: string;
  name?: string;
  closeProbability?: number;
}) {
  const setValues: Partial<typeof pipelineStages.$inferInsert> = {};
  if (params.name !== undefined) setValues.name = params.name;
  if (params.closeProbability !== undefined) setValues.closeProbability = params.closeProbability;

  if (Object.keys(setValues).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [updated] = await db
    .update(pipelineStages)
    .set(setValues)
    .where(
      and(
        eq(pipelineStages.id, params.stageId),
        eq(pipelineStages.agencyId, params.agencyId),
        isNull(pipelineStages.deletedAt)
      )
    )
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found." });
  return updated;
}

/**
 * Reorder = full permutation of the pipeline's active stages. The
 * (pipelineId, sortOrder) unique constraint makes naive in-place
 * renumbering collide mid-flight (assigning stage A the position stage B
 * still holds), so it's two-phase: shift every stage into a temporary
 * out-of-range band (+1000), then assign the final 0..n-1 — neither phase
 * can collide with the other or itself.
 */
export async function reorderStages(params: {
  agencyId: string;
  pipelineId: string;
  orderedStageIds: string[];
}) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const pipeline = await activePipelineById(tx, params.agencyId, params.pipelineId);
    if (!pipeline) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline not found." });

    const current = await tx
      .select({ id: pipelineStages.id, sortOrder: pipelineStages.sortOrder })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), isNull(pipelineStages.deletedAt)));

    const currentIds = new Set(current.map((stage) => stage.id));
    const providedIds = new Set(params.orderedStageIds);
    if (
      currentIds.size !== providedIds.size ||
      [...currentIds].some((stageId) => !providedIds.has(stageId))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "orderedStageIds must be exactly the pipeline's active stages.",
      });
    }

    // Phase 1: move everything out of the target range.
    await tx
      .update(pipelineStages)
      .set({ sortOrder: sql`${pipelineStages.sortOrder} + 1000` })
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), isNull(pipelineStages.deletedAt)));

    // Phase 2: final positions.
    for (const [index, stageId] of params.orderedStageIds.entries()) {
      await tx
        .update(pipelineStages)
        .set({ sortOrder: index })
        .where(eq(pipelineStages.id, stageId));
    }

    return tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), isNull(pipelineStages.deletedAt)))
      .orderBy(asc(pipelineStages.sortOrder));
  });
}

/** Archive (soft-delete) a stage. Guard: refuses while open, non-deleted deals sit in it. */
export async function archiveStage(params: { agencyId: string; stageId: string }) {
  return txDb.transaction(async (tx) => {
    await lockAgency(tx, params.agencyId);

    const stage = await activeStageById(tx, params.agencyId, params.stageId);
    if (!stage) throw new TRPCError({ code: "NOT_FOUND", message: "Stage not found." });

    const [openDeal] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(eq(deals.stageId, stage.id), eq(deals.status, "open"), isNull(deals.deletedAt))
      )
      .limit(1);
    if (openDeal) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This stage still has open deals — move them first.",
      });
    }

    const [archived] = await tx
      .update(pipelineStages)
      .set({ deletedAt: new Date() })
      .where(eq(pipelineStages.id, stage.id))
      .returning({ id: pipelineStages.id });
    return archived;
  });
}
