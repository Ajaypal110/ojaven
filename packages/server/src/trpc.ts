import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import { AgencySyncPendingError } from "./errors";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        reason:
          error.cause instanceof AgencySyncPendingError
            ? ("AGENCY_SYNC_PENDING" as const)
            : undefined,
      },
    };
  },
});

export const router = t.router;
/** Exported so middleware/*.ts can build named, reusable, correctly-typed middlewares. */
export const middleware = t.middleware;
export const publicProcedure = t.procedure;
