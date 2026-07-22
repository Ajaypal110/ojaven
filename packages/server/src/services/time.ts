import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { db, tasks, timeEntries } from "@ojaven/db";
import type { LogTimeEntryInput, UpdateTimeEntryInput } from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";
import { currentMonthInTimezone, getAgencyTimezone, todayInTimezone } from "./agencyClock";
import { retainerForMonth } from "./retainers";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** [start, nextStart) bounds for a YYYY-MM month, as YYYY-MM-DD strings. */
function monthBounds(month: string): { start: string; nextStart: string } {
  const start = `${month}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, nextStart: d.toISOString().slice(0, 10) };
}

type Actor = { userId: string; role: string };

/** Own entry, or an owner/admin — the correction matrix. */
function assertCanModify(entry: { userId: string }, actor: Actor) {
  const isOwn = entry.userId === actor.userId;
  const isAdmin = actor.role === "owner" || actor.role === "admin";
  if (!isOwn && !isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own time entries." });
  }
}

async function assertTaskInAgency(agencyId: string, taskId: string) {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.agencyId, agencyId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
}

async function assertNotFuture(agencyId: string, entryDate: string) {
  const tz = await getAgencyTimezone(agencyId);
  if (entryDate > todayInTimezone(tz)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Can't log time for a future date." });
  }
}

export async function logEntry(params: {
  agencyId: string;
  userId: string;
  input: LogTimeEntryInput;
}) {
  const { agencyId, userId, input } = params;
  await assertEntityLive(db, agencyId, "client", input.clientId);
  await assertNotFuture(agencyId, input.entryDate);
  if (input.taskId) await assertTaskInAgency(agencyId, input.taskId);

  const [row] = await db
    .insert(timeEntries)
    .values({
      agencyId,
      clientId: input.clientId,
      userId, // always the caller — log-on-behalf-of-others is deferred
      taskId: input.taskId ?? null,
      description: input.description || null,
      hours: input.hours.toFixed(2),
      entryDate: input.entryDate,
      isBillable: input.isBillable,
    })
    .returning();
  return row;
}

export async function updateEntry(params: {
  agencyId: string;
  actor: Actor;
  input: UpdateTimeEntryInput;
}) {
  const { agencyId, actor, input } = params;
  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.agencyId, agencyId), isNull(timeEntries.deletedAt)))
    .limit(1);
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Time entry not found." });
  assertCanModify(entry, actor);

  const set: Partial<typeof timeEntries.$inferInsert> = {};
  if (input.hours !== undefined) set.hours = input.hours.toFixed(2);
  if (input.description !== undefined) set.description = input.description || null;
  if (input.isBillable !== undefined) set.isBillable = input.isBillable;
  if (input.taskId !== undefined) {
    if (input.taskId) await assertTaskInAgency(agencyId, input.taskId);
    set.taskId = input.taskId;
  }
  if (input.entryDate !== undefined) {
    await assertNotFuture(agencyId, input.entryDate);
    set.entryDate = input.entryDate;
  }

  if (Object.keys(set).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [updated] = await db
    .update(timeEntries)
    .set(set)
    .where(and(eq(timeEntries.id, input.id), eq(timeEntries.agencyId, agencyId), isNull(timeEntries.deletedAt)))
    .returning();
  return updated;
}

export async function deleteEntry(params: { agencyId: string; actor: Actor; id: string }) {
  const { agencyId, actor, id } = params;
  const [entry] = await db
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.agencyId, agencyId), isNull(timeEntries.deletedAt)))
    .limit(1);
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Time entry not found." });
  assertCanModify(entry, actor);

  const [removed] = await db
    .update(timeEntries)
    .set({ deletedAt: new Date() })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.agencyId, agencyId), isNull(timeEntries.deletedAt)))
    .returning({ id: timeEntries.id });
  return removed;
}

async function resolveMonth(agencyId: string, month?: string): Promise<string> {
  return month ?? currentMonthInTimezone(await getAgencyTimezone(agencyId));
}

/**
 * A client's entries for a month, each marked isOverService — DERIVED here, not
 * stored: entries in chronological order, a running cumulative of BILLABLE
 * hours, and any billable entry whose cumulative exceeds that month's retainer
 * is over-service. Non-billable hours never consume the retainer. Returned
 * newest-first for display.
 */
export async function listByClient(params: { agencyId: string; clientId: string; month?: string }) {
  const { agencyId, clientId } = params;
  await assertEntityLive(db, agencyId, "client", clientId);
  const month = await resolveMonth(agencyId, params.month);
  const { start, nextStart } = monthBounds(month);

  const rows = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.agencyId, agencyId),
        eq(timeEntries.clientId, clientId),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.entryDate, start),
        lt(timeEntries.entryDate, nextStart)
      )
    )
    .orderBy(asc(timeEntries.entryDate), asc(timeEntries.createdAt));

  const retainer = await retainerForMonth(db, agencyId, clientId, start);
  const retainerHours = retainer ? Number(retainer.hoursPerMonth) : null;

  let running = 0;
  const entries = rows.map((e) => {
    let isOverService = false;
    if (e.isBillable) {
      running += Number(e.hours);
      isOverService = retainerHours != null && running > retainerHours;
    }
    return { ...e, isOverService };
  });
  entries.reverse(); // newest-first for display

  return { month, retainerHours, entries };
}

/** Hours vs the retainer in effect that month → over-service hours + %. */
export async function monthlyRollup(params: { agencyId: string; clientId: string; month?: string }) {
  const { agencyId, clientId } = params;
  await assertEntityLive(db, agencyId, "client", clientId);
  const month = await resolveMonth(agencyId, params.month);
  const { start, nextStart } = monthBounds(month);

  const rows = await db
    .select({ hours: timeEntries.hours, isBillable: timeEntries.isBillable })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.agencyId, agencyId),
        eq(timeEntries.clientId, clientId),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.entryDate, start),
        lt(timeEntries.entryDate, nextStart)
      )
    );

  let billable = 0;
  let nonBillable = 0;
  for (const r of rows) {
    const h = Number(r.hours);
    if (r.isBillable) billable += h;
    else nonBillable += h;
  }

  const retainer = await retainerForMonth(db, agencyId, clientId, start);
  const retainerHours = retainer ? Number(retainer.hoursPerMonth) : null;
  const overServiceHours = retainerHours != null ? round2(Math.max(0, billable - retainerHours)) : 0;
  const overServicePct =
    retainerHours != null && retainerHours > 0 ? round2((billable / retainerHours) * 100) : null;
  const isOverService = retainerHours != null && billable > retainerHours;

  return {
    clientId,
    month,
    retainerHours,
    totalHours: round2(billable + nonBillable),
    billableHours: round2(billable),
    nonBillableHours: round2(nonBillable),
    overServiceHours,
    overServicePct,
    isOverService,
  };
}
