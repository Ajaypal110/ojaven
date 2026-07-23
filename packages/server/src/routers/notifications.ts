import { listNotificationsSchema, notificationIdSchema } from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import { listNotifications, markAllRead, markRead, unreadCount } from "../services/notifications";

// Read side only (A9); writes are scheduled glue work. Everything is scoped to
// the caller — userId always from ctx, never input.
export const notificationsRouter = router({
  list: agencyProcedure
    .input(listNotificationsSchema)
    .query(({ ctx, input }) =>
      listNotifications({
        agencyId: ctx.agencyId,
        userId: ctx.userId,
        unreadOnly: input.unreadOnly,
        limit: input.limit,
      })
    ),

  unreadCount: agencyProcedure.query(({ ctx }) =>
    unreadCount({ agencyId: ctx.agencyId, userId: ctx.userId })
  ),

  markRead: agencyProcedure
    .input(notificationIdSchema)
    .mutation(({ ctx, input }) =>
      markRead({ agencyId: ctx.agencyId, userId: ctx.userId, id: input.id })
    ),

  markAllRead: agencyProcedure.mutation(({ ctx }) =>
    markAllRead({ agencyId: ctx.agencyId, userId: ctx.userId })
  ),
});
