import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

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
