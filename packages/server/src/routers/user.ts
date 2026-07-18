import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { agencies, teamMembers, users } from "@ojaven/db";
import { router } from "../trpc";
import { protectedProcedure } from "../procedures";

export const userRouter = router({
  /** Current user's own row, joined with their team memberships across agencies. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);

    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
    }

    const memberships = await ctx.db
      .select({
        agencyId: teamMembers.agencyId,
        role: teamMembers.role,
        agencyName: agencies.name,
      })
      .from(teamMembers)
      .innerJoin(agencies, eq(agencies.id, teamMembers.agencyId))
      .where(and(eq(teamMembers.userId, ctx.userId), isNull(teamMembers.deletedAt)));

    return { ...user, memberships };
  }),
});
