import { sql } from "drizzle-orm";
import { txDb } from "@ojaven/db/transactionClient";
import { router } from "../trpc";
import { publicProcedure } from "../procedures";

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
});
