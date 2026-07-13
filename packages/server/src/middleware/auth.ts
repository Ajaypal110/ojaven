import { TRPCError } from "@trpc/server";
import { middleware } from "../trpc";

/** Narrows ctx.userId from `string | null` to `string` for everything downstream. */
export const requireAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }

  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
