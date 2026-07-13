import type { logger } from "@ojaven/shared";

export interface MutationLogEvent {
  agencyId: string | undefined;
  userId: string | null;
  procedure: string;
  durationMs: number;
  ok: boolean;
}

/**
 * Deliberately a plain function, not a `t.middleware()` value like the
 * other files in this directory. The logging middleware needs `ctx` to
 * already include `agencyId`, which only exists after `requireAgency` has
 * run — that kind of "context so far" typing only infers correctly when
 * the `.use()` call is written inline at that exact point in the chain
 * (see procedures.ts), not when composed as a separately-defined,
 * reusable named middleware like requireAuth/requireAgency/rateLimited.
 * This function is the actual logging logic, called from that inline
 * middleware — kept here so it's testable in isolation from tRPC.
 */
export function logMutationEvent(log: typeof logger, event: MutationLogEvent) {
  log.info(event, "trpc.mutation");
}
