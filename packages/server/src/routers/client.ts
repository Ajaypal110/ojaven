import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { clients } from "@ojaven/db";
import { createClientSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";

export const clientRouter = router({
  list: agencyProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(clients)
      .where(eq(clients.agencyId, ctx.agencyId))
      .orderBy(desc(clients.createdAt));
  }),

  create: agencyProcedure.input(createClientSchema).mutation(async ({ ctx, input }) => {
    const [client] = await ctx.db
      .insert(clients)
      .values({
        agencyId: ctx.agencyId,
        name: input.name,
        website: input.website || null,
        industry: input.industry || null,
        status: input.status,
        ownerId: ctx.userId,
      })
      .returning();

    return client;
  }),

  byId: agencyProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [client] = await ctx.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, input.id), eq(clients.agencyId, ctx.agencyId)))
      .limit(1);

    if (!client) {
      // Same reasoning as the sign-up guard: don't distinguish "belongs to
      // another agency" from "doesn't exist" in the response shape.
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
    }

    return client;
  }),
});
