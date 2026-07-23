import { auditLogs, db } from "@ojaven/db";
import { logger } from "@ojaven/shared";
import type { EntityType } from "@ojaven/shared";

const MAX_STRING = 500;
const MAX_DEPTH = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid-shaped string or null — audit_logs.entityId is a uuid column. */
export function uuidish(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/**
 * Bound an arbitrary input snapshot for storage: long strings truncated with a
 * marker (a 100KB proposal bodyHtml must not bloat the audit table), depth
 * capped, functions/symbols dropped. Lossy by design — the baseline audit
 * answers "who did what to which record when", not "replay the exact payload".
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… [truncated ${value.length - MAX_STRING} chars]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[depth capped]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return undefined; // functions, symbols, bigints — not audit material
}

/**
 * Append one immutable audit row. NEVER throws.
 *
 * DELIBERATE, STAGE-APPROPRIATE SEMANTICS — WITH A REVISIT TRIGGER: an audit
 * write failure logs an error and lets the user's operation succeed. At this
 * stage, an op that succeeds without its audit row beats an op that fails
 * because auditing hiccuped. REVISIT if Ojaven ever serves compliance-bound
 * agencies (SOC 2, regulated clients): those regimes may require the inverse —
 * audit-write failure fails the operation (write the audit row inside the
 * mutation's transaction). This is deliberate now, not permanent.
 */
export async function writeAudit(params: {
  agencyId: string;
  actorUserId: string | null; // null = anonymous public actor (e.g. proposal recipient)
  action: string; // procedure path ("contacts.create") or semantic name ("proposal.accepted")
  entityType?: EntityType | null;
  entityId?: string | null;
  changes?: unknown;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      agencyId: params.agencyId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: uuidish(params.entityId),
      changes: params.changes == null ? null : sanitizeForAudit(params.changes),
    });
  } catch (err) {
    logger.error({ err, action: params.action, agencyId: params.agencyId }, "audit write failed");
  }
}
