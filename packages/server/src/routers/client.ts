import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { clients } from "@ojaven/db";
import { createClientSchema, updateClientSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";

const idInput = z.object({ id: z.string().uuid() });

export const clientRouter = router({
  list: agencyProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(clients)
      .where(and(eq(clients.agencyId, ctx.agencyId), isNull(clients.deletedAt)))
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

  byId: agencyProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [client] = await ctx.db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, input.id),
          eq(clients.agencyId, ctx.agencyId),
          isNull(clients.deletedAt)
        )
      )
      .limit(1);

    if (!client) {
      // Same reasoning as the sign-up guard: don't distinguish "belongs to
      // another agency" (or "already deleted") from "doesn't exist" in the
      // response shape.
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
    }

    return client;
  }),

  update: agencyProcedure
    .input(idInput.merge(updateClientSchema))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      // Only include keys actually present in the request — undefined here
      // means "not sent", not "clear this field". An empty string for
      // website/industry (explicitly sent) still means "clear it".
      const setValues: Partial<typeof clients.$inferInsert> = {};
      if (fields.name !== undefined) setValues.name = fields.name;
      if (fields.website !== undefined) setValues.website = fields.website || null;
      if (fields.industry !== undefined) setValues.industry = fields.industry || null;
      if (fields.status !== undefined) setValues.status = fields.status;

      const whereClause = and(
        eq(clients.id, id),
        eq(clients.agencyId, ctx.agencyId),
        isNull(clients.deletedAt)
      );

      const [client] =
        Object.keys(setValues).length === 0
          ? await ctx.db.select().from(clients).where(whereClause).limit(1)
          : await ctx.db.update(clients).set(setValues).where(whereClause).returning();

      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
      }

      return client;
    }),

  delete: agencyProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    // Soft delete, per packages/db's convention for this table — not an
    // actual DELETE.
    const [client] = await ctx.db
      .update(clients)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(clients.id, input.id),
          eq(clients.agencyId, ctx.agencyId),
          isNull(clients.deletedAt)
        )
      )
      .returning({ id: clients.id });

    if (!client) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
    }

    return client;
  }),
});
