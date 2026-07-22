import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clientContacts, clients, db, deals, tasks } from "@ojaven/db";
import { createTaskSchema, updateTaskSchema, type CreateTaskInput } from "@ojaven/shared";
import {
  createTask,
  deleteTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from "../src/services/tasks";
import { addNote, listActivitiesForEntity } from "../src/services/activities";
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
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  return agency;
}

/** A user who is an active member of the agency (a valid assignee). */
async function member(agencyId: string, label = "member") {
  const u = await seedUser(label);
  userIds.push(u.id);
  await ensureMembership({ agencyId, userId: u.id });
  return u;
}

/** A user with NO membership anywhere (an invalid assignee). */
async function outsider(label = "outsider") {
  const u = await seedUser(label);
  userIds.push(u.id);
  return u;
}

async function seedClient(agencyId: string, name = "Acme Co") {
  const [client] = await db.insert(clients).values({ agencyId, name }).returning();
  return client!;
}

async function seedContact(agencyId: string, clientId: string) {
  const [row] = await db
    .insert(clientContacts)
    .values({ agencyId, clientId, firstName: "Con" })
    .returning();
  return row!;
}

async function seedDeal(agencyId: string, clientId: string) {
  const { pipeline } = await ensureDefaultPipeline(agencyId);
  const [withStages] = await listPipelines(agencyId);
  const [row] = await db
    .insert(deals)
    .values({ agencyId, clientId, pipelineId: pipeline.id, stageId: withStages!.stages[0]!.id, name: "Deal" })
    .returning();
  return row!;
}

function taskInput(over: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return { title: "Task", priority: "medium", ...over };
}

// ── Assignee-member guard (pointer validation the FK can't do) ───────────────
describe("assignee-member guard", () => {
  it("accepts an active member, rejects a non-member and a cross-agency user", async () => {
    const a = await freshAgency();
    const me = await member(a.id, "assignee");
    const stranger = await outsider();

    const ok = await createTask({
      agencyId: a.id,
      actorUserId: me.id,
      input: taskInput({ assigneeId: me.id }),
    });
    expect(ok?.assigneeId).toBe(me.id);

    await expect(
      createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput({ assigneeId: stranger.id }) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /member of this agency/ });

    // A member of a DIFFERENT agency is still not a member here.
    const b = await freshAgency();
    const bMember = await member(b.id, "b-member");
    await expect(
      createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput({ assigneeId: bMember.id }) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update: rejects a non-member assignee, allows null (unassign)", async () => {
    const a = await freshAgency();
    const me = await member(a.id);
    const stranger = await outsider();
    const task = await createTask({
      agencyId: a.id,
      actorUserId: me.id,
      input: taskInput({ assigneeId: me.id }),
    });

    await expect(
      updateTask({ agencyId: a.id, input: { id: task!.id, assigneeId: stranger.id } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const unassigned = await updateTask({ agencyId: a.id, input: { id: task!.id, assigneeId: null } });
    expect(unassigned.assigneeId).toBeNull();
  });
});

// ── Conditional entity guard (linked vs standalone) ─────────────────────────
describe("entity link on create (optional; guarded only when present)", () => {
  it("standalone task needs no entity and stores nulls", async () => {
    const a = await freshAgency();
    const me = await member(a.id);
    const task = await createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput() });
    expect(task?.entityType).toBeNull();
    expect(task?.entityId).toBeNull();
  });

  it("links to a live client; rejects soft-deleted, cross-agency, and unbuilt types", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const me = await member(a.id);
    const client = await seedClient(a.id);

    const linked = await createTask({
      agencyId: a.id,
      actorUserId: me.id,
      input: taskInput({ entityType: "client", entityId: client.id }),
    });
    expect(linked?.entityType).toBe("client");

    // soft-deleted client
    const dead = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, dead.id));
    await expect(
      createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput({ entityType: "client", entityId: dead.id }) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // another agency's client
    const bClient = await seedClient(b.id);
    await expect(
      createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput({ entityType: "client", entityId: bClient.id }) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // unbuilt type
    await expect(
      createTask({
        agencyId: a.id,
        actorUserId: me.id,
        input: taskInput({ entityType: "invoice", entityId: "11111111-1111-1111-1111-111111111111" }),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /not available for invoice/ });
  });
});

describe("entity link is editable on update (association, not identity)", () => {
  it("attaches, moves, then clears — revalidating each time", async () => {
    const a = await freshAgency();
    const me = await member(a.id);
    const client = await seedClient(a.id);
    const deal = await seedDeal(a.id, client.id);
    const contact = await seedContact(a.id, client.id);

    // Standalone -> attach to contact.
    const task = await createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput() });
    let updated = await updateTask({
      agencyId: a.id,
      input: { id: task!.id, entityType: "client_contact", entityId: contact.id },
    });
    expect(updated.entityType).toBe("client_contact");

    // Move to the deal.
    updated = await updateTask({
      agencyId: a.id,
      input: { id: task!.id, entityType: "deal", entityId: deal.id },
    });
    expect(updated.entityType).toBe("deal");
    expect(updated.entityId).toBe(deal.id);

    // Clear (both null).
    updated = await updateTask({
      agencyId: a.id,
      input: { id: task!.id, entityType: null, entityId: null },
    });
    expect(updated.entityType).toBeNull();
    expect(updated.entityId).toBeNull();

    // Re-link to a soft-deleted client is refused.
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));
    await expect(
      updateTask({ agencyId: a.id, input: { id: task!.id, entityType: "client", entityId: client.id } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── both-or-neither (Zod boundary) ──────────────────────────────────────────
describe("both-or-neither entity link (Zod)", () => {
  it("create: half a link is rejected, both or neither is accepted", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(createTaskSchema.safeParse({ title: "t", entityType: "client" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "t", entityId: uuid }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "t" }).success).toBe(true);
    expect(
      createTaskSchema.safeParse({ title: "t", entityType: "client", entityId: uuid }).success
    ).toBe(true);
  });

  it("update: only-one-key rejected; both-null (clear) and both-set accepted", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(updateTaskSchema.safeParse({ id, entityType: "client" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ id, entityType: null, entityId: null }).success).toBe(true);
    expect(
      updateTaskSchema.safeParse({ id, entityType: "deal", entityId: uuid }).success
    ).toBe(true);
    expect(updateTaskSchema.safeParse({ id, title: "just a rename" }).success).toBe(true);
  });
});

// ── completedAt transition matrix (deliberately unlike deals.closedAt) ───────
describe("setTaskStatus — completedAt matrix", () => {
  it("done stamps completedAt; re-marking done PRESERVES it; un-done clears; cancelled != completed", async () => {
    const a = await freshAgency();
    const me = await member(a.id);
    const task = await createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput() });
    expect(task?.status).toBe("todo");
    expect(task?.completedAt).toBeNull();

    const done1 = await setTaskStatus({ agencyId: a.id, id: task!.id, status: "done" });
    expect(done1.status).toBe("done");
    expect(done1.completedAt).not.toBeNull();

    // Re-mark done — the original completion moment must survive.
    const done2 = await setTaskStatus({ agencyId: a.id, id: task!.id, status: "done" });
    expect(done2.completedAt?.getTime()).toBe(done1.completedAt?.getTime());

    // Un-done clears it.
    const back = await setTaskStatus({ agencyId: a.id, id: task!.id, status: "in_progress" });
    expect(back.completedAt).toBeNull();

    // Cancelled is not "completed".
    const cancelled = await setTaskStatus({ agencyId: a.id, id: task!.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.completedAt).toBeNull();
  });
});

// ── list filters + soft delete ──────────────────────────────────────────────
describe("listTasks filters", () => {
  it("filters by mine, status, and entity; excludes soft-deleted; agency-scoped", async () => {
    const a = await freshAgency();
    const me = await member(a.id, "me");
    const other = await member(a.id, "other");
    const client = await seedClient(a.id);

    const mineTask = await createTask({
      agencyId: a.id,
      actorUserId: me.id,
      input: taskInput({ title: "mine", assigneeId: me.id, entityType: "client", entityId: client.id }),
    });
    await createTask({
      agencyId: a.id,
      actorUserId: me.id,
      input: taskInput({ title: "theirs", assigneeId: other.id }),
    });
    const toDelete = await createTask({ agencyId: a.id, actorUserId: me.id, input: taskInput({ title: "gone" }) });
    await deleteTask({ agencyId: a.id, id: toDelete!.id });

    const mine = await listTasks({ agencyId: a.id, userId: me.id, mine: true });
    expect(mine.map((t) => t.title)).toEqual(["mine"]);

    const byEntity = await listTasks({
      agencyId: a.id,
      userId: me.id,
      entityType: "client",
      entityId: client.id,
    });
    expect(byEntity.map((t) => t.id)).toEqual([mineTask!.id]);

    await setTaskStatus({ agencyId: a.id, id: mineTask!.id, status: "done" });
    const doneOnly = await listTasks({ agencyId: a.id, userId: me.id, status: "done" });
    expect(doneOnly.map((t) => t.title)).toEqual(["mine"]);

    // The soft-deleted task never appears.
    const all = await listTasks({ agencyId: a.id, userId: me.id });
    expect(all.find((t) => t.title === "gone")).toBeUndefined();
  });
});

// ── Activities (unified timeline) ───────────────────────────────────────────
describe("activities — addNote + listForEntity", () => {
  it("appends notes and lists them newest-first with author, on a live entity", async () => {
    const a = await freshAgency();
    const me = await member(a.id, "author");
    const client = await seedClient(a.id);

    await addNote({ agencyId: a.id, authorId: me.id, entityType: "client", entityId: client.id, body: "first" });
    await addNote({ agencyId: a.id, authorId: me.id, entityType: "client", entityId: client.id, body: "second" });

    const timeline = await listActivitiesForEntity({
      agencyId: a.id,
      entityType: "client",
      entityId: client.id,
    });
    expect(timeline.map((n) => n.body)).toEqual(["second", "first"]); // newest-first
    expect(timeline[0]?.type).toBe("note");
    expect(timeline[0]?.authorId).toBe(me.id);
    expect(timeline[0]?.authorEmail).toBe(me.email); // author joined
  });

  it("read + write guard: soft-deleted and cross-agency entities are unreachable", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const me = await member(a.id);

    const dead = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, dead.id));
    await expect(
      addNote({ agencyId: a.id, authorId: me.id, entityType: "client", entityId: dead.id, body: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      listActivitiesForEntity({ agencyId: a.id, entityType: "client", entityId: dead.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const bClient = await seedClient(b.id);
    await expect(
      addNote({ agencyId: a.id, authorId: me.id, entityType: "client", entityId: bClient.id, body: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
