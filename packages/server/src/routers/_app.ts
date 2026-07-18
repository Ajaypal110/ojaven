import { router } from "../trpc";
import { healthRouter } from "./health";
import { userRouter } from "./user";
import { agencyRouter } from "./agency";
import { clientRouter } from "./client";
import { teamRouter } from "./team";

export const appRouter = router({
  health: healthRouter,
  user: userRouter,
  agency: agencyRouter,
  clients: clientRouter,
  team: teamRouter,
});

export type AppRouter = typeof appRouter;
