import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@ojaven/db";
import { txDb } from "@ojaven/db/transactionClient";
import { router } from "../trpc";
import { publicProcedure } from "../procedures";
import { provisionUserRow, tombstoneEmail } from "../services/userProvisioning";
import type { ClerkGateway } from "../services/clerkGateway";

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: Date.now(),
  })),

  /**
   * Probes the Pool/websocket transaction client end-to-end from inside
   * the actual runtime. Exists because the Vitest suite runs under plain
   * Node and CANNOT catch bundler-induced breakage of this client — which
   * is exactly what happened: webpack-bundled `ws` broke every txDb
   * connection in the Next runtime ("Connection terminated unexpectedly")
   * while all 27 tests passed. Curl this after any bundling/config change.
   */
  pingTx: publicProcedure.query(async () => {
    await txDb.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
    });
    return { status: "ok" as const, transactional: true, timestamp: Date.now() };
  }),

  /**
   * Live, self-contained reproduction of the recycled-email reclaim path
   * from inside the real runtime — the counterpart to the bug that bricked
   * accounts. Seeds an orphan row (old id + a throwaway email), then runs
   * the real provisionUserRow with a NEW id + the SAME email and a gateway
   * stubbed to report the old id as dead in Clerk. Asserts the orphan got
   * tombstoned and the new row created, then deletes both. Unauthenticated
   * and idempotent (unique email per run); curl to confirm the fix holds
   * end to end after any provisioning/bundling change.
   */
  pingReclaim: publicProcedure.query(async () => {
    const email = `reclaim-probe-${randomUUID()}@example.test`;
    const oldId = `user_probeOLD_${randomUUID().replace(/-/g, "")}`;
    const newId = `user_probeNEW_${randomUUID().replace(/-/g, "")}`;
    const deadInClerkGateway: ClerkGateway = {
      getUserLastSignInAt: async () => new Map(),
      createOrganizationInvitation: async () => "",
      removeOrganizationMember: async () => {},
      getUser: async () => null,
      getUserIdsForEmail: async () => [], // old id NOT live -> reclaimable
    };

    try {
      await db.insert(users).values({ id: oldId, email });
      await provisionUserRow({
        gateway: deadInClerkGateway,
        identity: { id: newId, email, firstName: null, lastName: null, imageUrl: null },
      });

      const [orphan] = await db.select().from(users).where(eq(users.id, oldId)).limit(1);
      const [reclaimed] = await db.select().from(users).where(eq(users.id, newId)).limit(1);

      const ok =
        orphan?.email === tombstoneEmail(oldId) &&
        orphan?.deletedAt != null &&
        reclaimed?.email === email &&
        reclaimed?.deletedAt == null;

      return { status: ok ? ("ok" as const) : ("FAILED" as const), reclaimed: ok };
    } finally {
      await db.delete(users).where(eq(users.id, oldId));
      await db.delete(users).where(eq(users.id, newId));
    }
  }),
});
