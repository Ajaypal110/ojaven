import { publicProcedure as baseProcedure } from "./trpc";
import { requireAuth } from "./middleware/auth";
import { requireAgency } from "./middleware/tenant";
import { rateLimited } from "./middleware/rateLimit";
import { logMutationEvent } from "./middleware/logging";

export const publicProcedure = baseProcedure.use(rateLimited);

export const protectedProcedure = publicProcedure.use(requireAuth);

export const agencyProcedure = protectedProcedure.use(requireAgency).use(async ({ ctx, next, path, type }) => {
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

  return result;
});
