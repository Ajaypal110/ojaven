import { sql } from "drizzle-orm";
import type { Tx } from "@ojaven/db/transactionClient";

/**
 * Serializes a critical section on an arbitrary string key via a
 * transaction-scoped advisory lock (released automatically at commit/
 * rollback). The namespace prefix keeps distinct key kinds (agency ids vs.
 * emails) from sharing a hash bucket meaningfully — though even a raw
 * collision would only briefly serialize two unrelated keys, which is
 * harmless. One shared implementation for every check-then-act service.
 */
export async function lockKey(tx: Tx, namespace: string, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${namespace}:${key}`}))`);
}

/** Per-agency lock — the original, now a thin wrapper over lockKey. */
export async function lockAgency(tx: Tx, agencyId: string) {
  await lockKey(tx, "agency", agencyId);
}
