import { router } from "../trpc";
import { publicProcedure } from "../procedures";

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: Date.now(),
  })),
});
