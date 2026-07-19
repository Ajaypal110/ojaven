import { sql } from "drizzle-orm";
import type { Tx } from "@ojaven/db/transactionClient";

/**
 * Serializes mutations per agency via a transaction-scoped advisory lock
 * (released automatically at commit/rollback). One shared implementation
 * for every service with check-then-act sequences: membership bootstrap,
 * ownership lifecycle/recovery, pipeline structure. hashtext collisions
 * across agencies just serialize two unrelated agencies briefly — harmless.
 */
export async function lockAgency(tx: Tx, agencyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`);
}
