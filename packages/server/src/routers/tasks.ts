import {
  createTaskSchema,
  listTasksSchema,
  setTaskStatusSchema,
  taskIdSchema,
  updateTaskSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure } from "../procedures";
import { createTask, deleteTask, listTasks, setTaskStatus, updateTask } from "../services/tasks";

// Tasks are DATA — every op is agencyProcedure (all roles). Correctness (the
// assignee-member guard, the conditional entity guard, the completedAt
// invariant) lives in the service.
export const tasksRouter = router({
  list: agencyProcedure.input(listTasksSchema).query(({ ctx, input }) =>
    listTasks({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      mine: input.mine,
      status: input.status,
      entityType: input.entityType,
      entityId: input.entityId,
    })
  ),

  create: agencyProcedure
    .input(createTaskSchema)
    .mutation(({ ctx, input }) =>
      createTask({ agencyId: ctx.agencyId, actorUserId: ctx.userId, input })
    ),

  update: agencyProcedure
    .input(updateTaskSchema)
    .mutation(({ ctx, input }) => updateTask({ agencyId: ctx.agencyId, input })),

  setStatus: agencyProcedure
    .input(setTaskStatusSchema)
    .mutation(({ ctx, input }) =>
      setTaskStatus({ agencyId: ctx.agencyId, id: input.id, status: input.status })
    ),

  delete: agencyProcedure
    .input(taskIdSchema)
    .mutation(({ ctx, input }) => deleteTask({ agencyId: ctx.agencyId, id: input.id })),
});
