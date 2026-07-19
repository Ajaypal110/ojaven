import { router } from "../trpc";
import { healthRouter } from "./health";
import { userRouter } from "./user";
import { agencyRouter } from "./agency";
import { clientRouter } from "./client";
import { teamRouter } from "./team";
import { pipelineRouter } from "./pipeline";
import { dealsRouter } from "./deals";

export const appRouter = router({
  health: healthRouter,
  user: userRouter,
  agency: agencyRouter,
  clients: clientRouter,
  team: teamRouter,
  pipeline: pipelineRouter,
  deals: dealsRouter,
});

export type AppRouter = typeof appRouter;
