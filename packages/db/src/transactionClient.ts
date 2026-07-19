import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Node's native WebSocket (stable since Node 22; local dev is 22.x, Vercel
// runs 24.x). Deliberately NOT the `ws` package: webpack-bundled `ws`
// breaks Neon's Pool inside the Next runtime — first as "Connection
// terminated unexpectedly", then (with attempted externalization, which
// transpilePackages overrides for imports reaching through @ojaven/db) as
// "bufferUtil.mask is not a function". Native WebSocket has no package to
// bundle, so there is nothing for the bundler to get wrong. Verified via
// the health.pingTx probe, which exists precisely because the vitest suite
// runs under plain Node and cannot catch bundler-induced breakage.
if (typeof WebSocket === "undefined") {
  throw new Error(
    "@ojaven/db transactionClient requires a runtime with native WebSocket (Node >= 22)."
  );
}
neonConfig.webSocketConstructor = WebSocket;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * The interactive-transaction client (Pool/websocket driver) that
 * README.md reserved for flows with branching logic inside a transaction.
 * First real consumer: team-membership bootstrap + ownership transfer in
 * packages/server/src/services — first-member detection and owner-count
 * guards are check-then-act sequences that must be atomic (serialized per
 * agency via pg_advisory_xact_lock), which db.batch() can't express.
 *
 * Node.js runtime only — NOT Edge-deployable. The default `db` export
 * (neon-http) remains the right client for everything else.
 */
export const txDb = drizzle(pool, { schema });

export type TxDb = typeof txDb;
export type Tx = Parameters<Parameters<TxDb["transaction"]>[0]>[0];
