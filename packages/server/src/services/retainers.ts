import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, lte, or, gte } from "drizzle-orm";
import { db, retainers } from "@ojaven/db";
import { txDb } from "@ojaven/db/transactionClient";
import type { SetRetainerInput } from "@ojaven/shared";
import { lockKey } from "./agencyLock";
import { assertEntityLive } from "./entityRef";

/** The day before a YYYY-MM-DD date, as YYYY-MM-DD (UTC math on a bare date). */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505"
  );
}

/** The open (current) retainer for a client, or null. */
export async function getCurrentRetainer(agencyId: string, clientId: string) {
  const [row] = await db
    .select()
    .from(retainers)
    .where(
      and(
        eq(retainers.agencyId, agencyId),
        eq(retainers.clientId, clientId),
        isNull(retainers.effectiveTo)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Full retainer history for a client, newest period first. */
export function listRetainers(agencyId: string, clientId: string) {
  return db
    .select()
    .from(retainers)
    .where(and(eq(retainers.agencyId, agencyId), eq(retainers.clientId, clientId)))
    .orderBy(desc(retainers.effectiveFrom));
}

/**
 * The retainer in effect for a given month (monthStart = YYYY-MM-01): the
 * period whose window covers that month's first day. effectiveFrom is always a
 * 1st-of-month and effectiveTo the last day of a month, so each month maps to
 * exactly one period (or none). Accepts a db-or-tx handle.
 */
export async function retainerForMonth(
  dbc: typeof db,
  agencyId: string,
  clientId: string,
  monthStart: string
) {
  const [row] = await dbc
    .select({ hoursPerMonth: retainers.hoursPerMonth })
    .from(retainers)
    .where(
      and(
        eq(retainers.agencyId, agencyId),
        eq(retainers.clientId, clientId),
        lte(retainers.effectiveFrom, monthStart),
        or(isNull(retainers.effectiveTo), gte(retainers.effectiveTo, monthStart))
      )
    )
    .orderBy(desc(retainers.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/**
 * Set a client's retainer effective from a 1st-of-month. Closes the current
 * open period (effectiveTo = the day before the new effectiveFrom) and opens
 * the new one — serialized by a per-client advisory lock, with the
 * one-open-per-client partial unique index as the DB backstop (same
 * lock+constraint shape as one-primary-contact). effectiveFrom must be strictly
 * after the current open period's start.
 */
export async function setRetainer(params: { agencyId: string; input: SetRetainerInput }) {
  const { agencyId, input } = params;
  await assertEntityLive(db, agencyId, "client", input.clientId);

  try {
    return await txDb.transaction(async (tx) => {
      await lockKey(tx, "client-retainer", input.clientId);

      const [open] = await tx
        .select()
        .from(retainers)
        .where(
          and(
            eq(retainers.agencyId, agencyId),
            eq(retainers.clientId, input.clientId),
            isNull(retainers.effectiveTo)
          )
        )
        .limit(1);

      if (open) {
        if (input.effectiveFrom <= open.effectiveFrom) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "New retainer must take effect after the current one started.",
          });
        }
        await tx
          .update(retainers)
          .set({ effectiveTo: dayBefore(input.effectiveFrom) })
          .where(eq(retainers.id, open.id));
      }

      const [created] = await tx
        .insert(retainers)
        .values({
          agencyId,
          clientId: input.clientId,
          hoursPerMonth: input.hoursPerMonth.toFixed(2),
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Two concurrent opens raced past the lock — the partial index caught it.
      throw new TRPCError({
        code: "CONFLICT",
        message: "The retainer was just changed — reload and try again.",
      });
    }
    throw err;
  }
}
