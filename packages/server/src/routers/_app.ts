import { router } from "../trpc";
import { healthRouter } from "./health";
import { userRouter } from "./user";
import { agencyRouter } from "./agency";

export const appRouter = router({
  health: healthRouter,
  user: userRouter,
  agency: agencyRouter,
});

export type AppRouter = typeof appRouter;
