import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { teamMembers } from "@ojaven/db";
import { publicProcedure as baseProcedure } from "./trpc";
import { requireAuth } from "./middleware/auth";
import { requireAgency } from "./middleware/tenant";
import { rateLimited } from "./middleware/rateLimit";
import { logMutationEvent } from "./middleware/logging";
import { uuidish, writeAudit } from "./services/audit";

export const publicProcedure = baseProcedure.use(rateLimited);

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Every agencyProcedure MUTATION (teamProcedure inherits this too) is audited
 * automatically — the uniform baseline nobody can forget, chosen over ~30
 * explicit service call sites (the forgotten-lock failure class). Baseline
 * fidelity, deliberately honest: action = procedure path, changes = truncated
 * input snapshot, entityId best-effort (input.id, else the returned row's id
 * on creates), entityType null. Semantic enrichment (before/after diffs,
 * entity typing) comes via services/audit.writeAudit in the glue pass.
 * Success-only: failed mutations changed nothing (pino has them already).
 */
export const agencyProcedure = protectedProcedure
  .use(requireAgency)
  .use(async ({ ctx, next, path, type, getRawInput }) => {
    if (type !== "mutation") {
      return next();
    }

    const start = Date.now();
    const result = await next();

    logMutationEvent(ctx.logger, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      procedure: path,
      durationMs: Date.now() - start,
      ok: result.ok,
    });

    if (result.ok) {
      const rawInput = await getRawInput().catch(() => undefined);
      const input = rawInput as Record<string, unknown> | undefined;
      const output = (result as { data?: unknown }).data as Record<string, unknown> | undefined;
      await writeAudit({
        agencyId: ctx.agencyId,
        actorUserId: ctx.userId,
        action: path,
        entityId: uuidish(input?.id) ?? uuidish(output?.id),
        // Raw here — writeAudit sanitizes exactly once (double-sanitizing
        // truncates the first pass's truncation marker; a test caught it).
        changes: input == null ? null : { input },
      });
    }

    return result;
  });

/**
 * agencyProcedure + a resolved team_members row: ctx.teamMember carries
 * the caller's membership id and role for the role matrix in the team
 * services. Deliberately does NOT auto-create the row — bootstrap happens
 * only through the explicit team.ensureMembership mutation (called by
 * onboarding and the (product) layout effect), never as a middleware side
 * effect. Inlined here rather than a named middleware in middleware/ for
 * the same positional-typing reason documented in middleware/logging.ts:
 * it needs ctx.agencyId, which only exists at this point in the chain.
 *
 * team.ensureMembership itself must stay on agencyProcedure (chicken/egg).
 */
export const teamProcedure = agencyProcedure.use(async ({ ctx, next }) => {
  const [member] = await ctx.db
    .select({ id: teamMembers.id, role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.agencyId, ctx.agencyId),
        eq(teamMembers.userId, ctx.userId),
        isNull(teamMembers.deletedAt)
      )
    )
    .limit(1);

  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You're not a member of this team yet.",
    });
  }

  return next({ ctx: { teamMember: member } });
});
