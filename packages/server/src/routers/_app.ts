import { router } from "../trpc";
import { healthRouter } from "./health";
import { userRouter } from "./user";
import { agencyRouter } from "./agency";
import { clientRouter } from "./client";

export const appRouter = router({
  health: healthRouter,
  user: userRouter,
  agency: agencyRouter,
  clients: clientRouter,
});

export type AppRouter = typeof appRouter;
