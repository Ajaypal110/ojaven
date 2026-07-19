import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { clients, db, pipelineStages } from "@ojaven/db";
import {
  archivePipeline,
  archiveStage,
  createStage,
  ensureDefaultPipeline,
  listPipelines,
  reorderStages,
} from "../src/services/pipeline";
import {
  createDeal,
  getDealById,
  listDeals,
  moveDealStage,
  setDealStatus,
} from "../src/services/deals";
import { ensureMembership } from "../src/services/teamMembership";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

async function seedPipelineScene() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  const ownerUser = await seedUser("owner");
  userIds.push(ownerUser.id);
  await ensureMembership({ agencyId: agency.id, userId: ownerUser.id });

  const [client] = await db
    .insert(clients)
    .values({ agencyId: agency.id, name: "Pipeline Test Client" })
    .returning();

  const { pipeline } = await ensureDefaultPipeline(agency.id);
  const [withStages] = await listPipelines(agency.id);

  return { agency, ownerUser, client: client!, pipeline, stages: withStages!.stages };
}

describe("ensureDefaultPipeline", () => {
  it("seeds Sales with the four approved stages at 10/35/60/80", async () => {
    const { stages } = await seedPipelineScene();
    expect(stages.map((s) => [s.name, s.closeProbability])).toEqual([
      ["Lead", 10],
      ["Qualified", 35],
      ["Proposal sent", 60],
      ["Negotiation", 80],
    ]);
  });

  it("is idempotent sequentially AND under concurrency (advisory lock)", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);

    await Promise.all(Array.from({ length: 5 }, () => ensureDefaultPipeline(agency.id)));
    const again = await ensureDefaultPipeline(agency.id);
    expect(again.created).toBe(false);

    const pipelinesAfter = await listPipelines(agency.id);
    expect(pipelinesAfter).toHaveLength(1);
    expect(pipelinesAfter[0]?.stages).toHaveLength(4);
  });
});

describe("reorderStages under the (pipelineId, sortOrder) unique constraint", () => {
  it("survives a full reversal — every stage passes through colliding positions", async () => {
    const { agency, pipeline, stages } = await seedPipelineScene();

    const reversed = [...stages].map((s) => s.id).reverse();
    const result = await reorderStages({
      agencyId: agency.id,
      pipelineId: pipeline!.id,
      orderedStageIds: reversed,
    });

    expect(result.map((s) => s.name)).toEqual([
      "Negotiation",
      "Proposal sent",
      "Qualified",
      "Lead",
    ]);
    expect(result.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("survives a partial swap (adjacent exchange)", async () => {
    const { agency, pipeline, stages } = await seedPipelineScene();
    const ids = stages.map((s) => s.id);
    const swapped = [ids[1]!, ids[0]!, ids[2]!, ids[3]!];

    const result = await reorderStages({
      agencyId: agency.id,
      pipelineId: pipeline!.id,
      orderedStageIds: swapped,
    });
    expect(result.map((s) => s.name)).toEqual([
      "Qualified",
      "Lead",
      "Proposal sent",
      "Negotiation",
    ]);
  });

  it("rejects a set that isn't exactly the pipeline's active stages", async () => {
    const { agency, pipeline, stages } = await seedPipelineScene();

    await expect(
      reorderStages({
        agencyId: agency.id,
        pipelineId: pipeline!.id,
        orderedStageIds: stages.slice(1).map((s) => s.id), // one missing
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("client soft-delete join filter (zero-mutation restore)", () => {
  it("hides deals of a soft-deleted client everywhere, restores visibility on client restore", async () => {
    const { agency, ownerUser, client } = await seedPipelineScene();

    const deal = await createDeal({
      agencyId: agency.id,
      actorUserId: ownerUser.id,
      input: { clientId: client.id, name: "Big retainer", value: 5000 },
    });

    expect(await listDeals({ agencyId: agency.id })).toHaveLength(1);

    // Soft-delete the client — NOT the deal. No deal rows are written.
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));

    expect(await listDeals({ agencyId: agency.id })).toHaveLength(0);
    await expect(getDealById({ agencyId: agency.id, id: deal!.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Creating new deals on the soft-deleted client is refused too.
    await expect(
      createDeal({
        agencyId: agency.id,
        actorUserId: ownerUser.id,
        input: { clientId: client.id, name: "Should fail" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Restore the client — deals reappear with zero writes to deals.
    await db.update(clients).set({ deletedAt: null }).where(eq(clients.id, client.id));
    const restored = await listDeals({ agencyId: agency.id });
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(deal!.id);
  });
});

describe("deal creation defaults", () => {
  it("lands in the default pipeline's first stage when neither is specified", async () => {
    const { agency, ownerUser, client, pipeline, stages } = await seedPipelineScene();

    const deal = await createDeal({
      agencyId: agency.id,
      actorUserId: ownerUser.id,
      input: { clientId: client.id, name: "Defaulted deal" },
    });
    expect(deal?.pipelineId).toBe(pipeline!.id);
    expect(deal?.stageId).toBe(stages[0]!.id); // Lead
    expect(deal?.value).toBe("0.00");
    expect(deal?.ownerId).toBe(ownerUser.id);
  });
});

describe("moveDealStage", () => {
  it("moves within the pipeline; refuses cross-pipeline with a clear error", async () => {
    const { agency, ownerUser, client, pipeline, stages } = await seedPipelineScene();
    const deal = await createDeal({
      agencyId: agency.id,
      actorUserId: ownerUser.id,
      input: { clientId: client.id, name: "Mover" },
    });

    const moved = await moveDealStage({
      agencyId: agency.id,
      id: deal!.id,
      stageId: stages[2]!.id,
    });
    expect(moved?.stageId).toBe(stages[2]!.id);

    // Second pipeline + stage in the same agency.
    const { createPipeline } = await import("../src/services/pipeline");
    const other = await createPipeline({ agencyId: agency.id, name: "Upsells" });
    const otherStage = await createStage({
      agencyId: agency.id,
      pipelineId: other!.id,
      name: "Only stage",
    });

    await expect(
      moveDealStage({ agencyId: agency.id, id: deal!.id, stageId: otherStage!.id })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("different pipeline"),
    });
  });
});

describe("archive guards", () => {
  it("pipeline: refuses with open deals, allows after they close; stage: refuses, allows after move-out", async () => {
    const { agency, ownerUser, client, pipeline, stages } = await seedPipelineScene();
    const deal = await createDeal({
      agencyId: agency.id,
      actorUserId: ownerUser.id,
      input: { clientId: client.id, name: "Blocker" },
    });

    // Stage guard: the deal sits in Lead (stage[0]).
    await expect(
      archiveStage({ agencyId: agency.id, stageId: stages[0]!.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Move it out — stage archive now succeeds.
    await moveDealStage({ agencyId: agency.id, id: deal!.id, stageId: stages[1]!.id });
    const archivedStage = await archiveStage({ agencyId: agency.id, stageId: stages[0]!.id });
    expect(archivedStage?.id).toBe(stages[0]!.id);

    // Pipeline guard: still an open deal.
    await expect(
      archivePipeline({ agencyId: agency.id, id: pipeline!.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Win it — pipeline archive now succeeds, and closedAt was set.
    const won = await setDealStatus({ agencyId: agency.id, id: deal!.id, status: "won" });
    expect(won?.closedAt).not.toBeNull();
    const archivedPipeline = await archivePipeline({ agencyId: agency.id, id: pipeline!.id });
    expect(archivedPipeline?.id).toBe(pipeline!.id);

    // Archived structure disappears from list.
    expect(await listPipelines(agency.id)).toHaveLength(0);

    // Archived stage rows stay filtered out of stage lists too.
    const remainingStages = await db
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline!.id), isNull(pipelineStages.deletedAt)));
    expect(remainingStages.map((s) => s.id)).not.toContain(stages[0]!.id);
  });
});
