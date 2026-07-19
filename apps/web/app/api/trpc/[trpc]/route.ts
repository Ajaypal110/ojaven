import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@ojaven/server";
import { logger } from "@ojaven/shared";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    // Without this, a 500 from a procedure is invisible server-side — the
    // fetch adapter has no default error logging, which is exactly how the
    // ensureMembership/ws bundling failure stayed silent until diagnosed
    // from the mutation-duration log alone.
    onError({ error, path }) {
      logger.error({ err: error, path }, "trpc handler error");
    },
  });

export { handler as GET, handler as POST };
