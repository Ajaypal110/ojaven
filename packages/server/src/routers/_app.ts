import { router } from "../trpc";
import { healthRouter } from "./health";
import { userRouter } from "./user";
import { agencyRouter } from "./agency";
import { clientRouter } from "./client";
import { contactsRouter } from "./contacts";
import { tagsRouter } from "./tags";
import { customFieldsRouter } from "./customFields";
import { tasksRouter } from "./tasks";
import { activitiesRouter } from "./activities";
import { timeRouter } from "./time";
import { retainersRouter } from "./retainers";
import { proposalsRouter } from "./proposals";
import { invoicesRouter } from "./invoices";
import { publicRouter } from "./public";
import { teamRouter } from "./team";
import { pipelineRouter } from "./pipeline";
import { dealsRouter } from "./deals";
import { settingsRouter } from "./settings";

export const appRouter = router({
  health: healthRouter,
  user: userRouter,
  agency: agencyRouter,
  clients: clientRouter,
  contacts: contactsRouter,
  tags: tagsRouter,
  customFields: customFieldsRouter,
  tasks: tasksRouter,
  activities: activitiesRouter,
  time: timeRouter,
  retainers: retainersRouter,
  proposals: proposalsRouter,
  invoices: invoicesRouter,
  public: publicRouter,
  team: teamRouter,
  pipeline: pipelineRouter,
  deals: dealsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
