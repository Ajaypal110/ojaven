import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, notifications } from "@ojaven/db";

/**
 * Read side only (A9). Event-driven WRITES (assignment -> notify assignee,
 * invoice paid -> notify owner, ...) are scheduled glue work — the recovery
 * module is the only writer today. Everything here is scoped to the CALLER's
 * own rows: userId always comes from ctx, never from input.
 */

export async function listNotifications(params: {
  agencyId: string;
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
}) {
  const conds = [
    eq(notifications.agencyId, params.agencyId),
    eq(notifications.userId, params.userId),
  ];
  if (params.unreadOnly) conds.push(isNull(notifications.readAt));
  return db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(params.limit ?? 50);
}

export async function unreadCount(params: { agencyId: string; userId: string }) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.agencyId, params.agencyId),
        eq(notifications.userId, params.userId),
        isNull(notifications.readAt)
      )
    );
  return { count: Number(row?.n ?? 0) };
}

/** Idempotent: marking an already-read notification keeps its original readAt. */
export async function markRead(params: { agencyId: string; userId: string; id: string }) {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, params.id),
        eq(notifications.agencyId, params.agencyId),
        eq(notifications.userId, params.userId), // own rows only
        isNull(notifications.readAt)
      )
    )
    .returning();
  if (updated) return updated;

  // Already read, or not yours/nonexistent — distinguish readably.
  const [existing] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, params.id),
        eq(notifications.agencyId, params.agencyId),
        eq(notifications.userId, params.userId)
      )
    )
    .limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
  return existing; // already read — idempotent, original readAt preserved
}

export async function markAllRead(params: { agencyId: string; userId: string }) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.agencyId, params.agencyId),
        eq(notifications.userId, params.userId),
        isNull(notifications.readAt)
      )
    );
  return { ok: true as const };
}
