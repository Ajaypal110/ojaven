import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

/**
 * neon-http is a single-round-trip HTTP driver — it's Edge-runtime
 * compatible but does NOT support interactive multi-statement
 * transactions (BEGIN/COMMIT). Use `db.batch([...])` for atomic
 * multi-statement writes instead. If a specific mutation genuinely
 * needs interactive transactions (e.g. read-modify-write with
 * branching logic), that route should use the `neon-serverless`
 * (Pool/websocket) driver instead — Node.js runtime only, not Edge.
 */
