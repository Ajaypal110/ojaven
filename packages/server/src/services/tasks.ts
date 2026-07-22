import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, tasks, teamMembers } from "@ojaven/db";
import type { CreateTaskInput, TaskStatus, UpdateTaskInput } from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";

/**
 * The assignee must be an ACTIVE member of this agency. assigneeId -> users is
 * the global identity table, and the FK only proves the user exists — not that
 * they belong here. This is the assignee-pointer equivalent of assertEntityLive
 * (pointer validation the FK can't do). Null = unassigned, always allowed.
 */
async function assertAssigneeMember(agencyId: string, assigneeId: string) {
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, agencyId),
        eq(teamMembers.userId, assigneeId),
        isNull(teamMembers.deletedAt)
      )
    )
    .limit(1);
  if (!member) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Assignee must be a member of this agency." });
  }
}

export async function listTasks(params: {
  agencyId: string;
  userId: string;
  mine?: boolean;
  status?: TaskStatus;
  entityType?: (typeof tasks.$inferSelect)["entityType"];
  entityId?: string;
}) {
  const conds = [eq(tasks.agencyId, params.agencyId), isNull(tasks.deletedAt)];
  if (params.mine) conds.push(eq(tasks.assigneeId, params.userId));
  if (params.status) conds.push(eq(tasks.status, params.status));
  // Entity filter is agency-scoped, so no assertEntityLive needed — a foreign
  // or soft-deleted entityId simply matches nothing here (unlike a write).
  if (params.entityType && params.entityId) {
    conds.push(eq(tasks.entityType, params.entityType));
    conds.push(eq(tasks.entityId, params.entityId));
  }
  return db
    .select()
    .from(tasks)
    .where(and(...conds))
    // Soonest-due first (Postgres asc -> NULLS LAST, so undated tasks trail),
    // newest as tiebreak.
    .orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
}

export async function createTask(params: {
  agencyId: string;
  actorUserId: string;
  input: CreateTaskInput;
}) {
  const { agencyId, actorUserId, input } = params;

  if (input.assigneeId) await assertAssigneeMember(agencyId, input.assigneeId);
  // Entity link is optional; validate only when present (both-or-neither is
  // guaranteed by the schema).
  if (input.entityType && input.entityId) {
    await assertEntityLive(db, agencyId, input.entityType, input.entityId);
  }

  const [task] = await db
    .insert(tasks)
    .values({
      agencyId,
      title: input.title,
      description: input.description || null,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      createdById: actorUserId,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      // status defaults to "todo"; completedAt stays null (set only via setStatus).
    })
    .returning();
  return task;
}

/**
 * Presence-based update. Never touches status (that's setStatus, which owns
 * completedAt). The entity link is an ASSOCIATION, so it's editable: absent =
 * untouched, explicit null = clear, both-set = relink (revalidated).
 */
export async function updateTask(params: { agencyId: string; input: UpdateTaskInput }) {
  const { agencyId, input } = params;

  const set: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.description !== undefined) set.description = input.description || null;
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.dueAt !== undefined) set.dueAt = input.dueAt ? new Date(input.dueAt) : null;

  if (input.assigneeId !== undefined) {
    if (input.assigneeId) await assertAssigneeMember(agencyId, input.assigneeId);
    set.assigneeId = input.assigneeId; // string or null
  }

  // Link: only when a key was sent (both-or-neither guaranteed by schema).
  if (input.entityType !== undefined || input.entityId !== undefined) {
    if (input.entityType === null) {
      set.entityType = null;
      set.entityId = null;
    } else {
      await assertEntityLive(db, agencyId, input.entityType!, input.entityId!);
      set.entityType = input.entityType!;
      set.entityId = input.entityId!;
    }
  }

  if (Object.keys(set).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [updated] = await db
    .update(tasks)
    .set(set)
    .where(and(eq(tasks.id, input.id), eq(tasks.agencyId, agencyId), isNull(tasks.deletedAt)))
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
  return updated;
}

/**
 * The only path that changes status, and it owns completedAt:
 *   done      -> preserve the EXISTING completion moment (fall back to now)
 *   otherwise -> null
 *
 * DELIBERATELY different from deals.setDealStatus (which stamps closedAt = now
 * on every non-open transition): the original completion moment is the true
 * one, and Time Tracking + throughput reporting will read it — overwriting it
 * on an idempotent re-mark to "done" would corrupt completion history. Don't
 * "fix" this to match deals. cancelled is not "completed" (no timestamp).
 */
export async function setTaskStatus(params: { agencyId: string; id: string; status: TaskStatus }) {
  const { agencyId, id, status } = params;

  const [current] = await db
    .select({ completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.agencyId, agencyId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });

  const completedAt = status === "done" ? (current.completedAt ?? new Date()) : null;

  const [updated] = await db
    .update(tasks)
    .set({ status, completedAt })
    .where(and(eq(tasks.id, id), eq(tasks.agencyId, agencyId), isNull(tasks.deletedAt)))
    .returning();
  return updated;
}

export async function deleteTask(params: { agencyId: string; id: string }) {
  const [removed] = await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(and(eq(tasks.id, params.id), eq(tasks.agencyId, params.agencyId), isNull(tasks.deletedAt)))
    .returning({ id: tasks.id });
  if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
  return removed;
}
