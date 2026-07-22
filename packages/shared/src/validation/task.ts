import { z } from "zod";
import { entityTypeValues } from "./taxonomy";

// Independent copies of the DB enums (leaf package, same convention as
// clientStatusValues).
export const taskStatusValues = ["todo", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

export const taskPriorityValues = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof taskPriorityValues)[number];

// A task's entity link is OPTIONAL and polymorphic. entityType/entityId must
// travel together — a type without an id (or vice versa) is a corrupt
// half-link. These refinements enforce both-or-neither so the service never
// sees one.
const createLinkComplete = (v: { entityType?: unknown; entityId?: unknown }) =>
  (v.entityType == null) === (v.entityId == null); // undefined/absent counts as null

// Update is three-way: absent = untouched, both-null = clear, both-set = relink.
const updateLinkComplete = (v: { entityType?: unknown; entityId?: unknown }) => {
  const tSet = v.entityType !== undefined;
  const iSet = v.entityId !== undefined;
  if (tSet !== iSet) return false; // exactly one key sent
  if (!tSet) return true; // neither sent — link untouched
  return (v.entityType === null) === (v.entityId === null); // both sent: both-null or both-value
};
const linkMessage = { message: "entityType and entityId must be set together.", path: ["entityId"] };

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  priority: z.enum(taskPriorityValues),
  // assigneeId is a Clerk user id (text), not a uuid. Membership is verified
  // in the service (the FK proves existence, not agency membership).
  assigneeId: z.string().min(1).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
};

export const createTaskSchema = z
  .object({
    ...taskFields,
    // Default lives ONLY on create (never survives into the partial update).
    priority: taskFields.priority.default("medium"),
    entityType: z.enum(entityTypeValues).optional(),
    entityId: z.string().uuid().optional(),
    // status is intentionally absent: a task is always born "todo"; status
    // transitions (and the completedAt invariant) go only through setStatus.
  })
  .refine(createLinkComplete, linkMessage);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    id: z.string().uuid(),
    ...taskFields,
    // Association is editable (attach/move/clear), unlike identity. Nullable so
    // an explicit null clears the link / unassigns.
    entityType: z.enum(entityTypeValues).nullable().optional(),
    entityId: z.string().uuid().nullable().optional(),
  })
  .partial({
    title: true,
    description: true,
    priority: true,
    assigneeId: true,
    dueAt: true,
  })
  .refine(updateLinkComplete, linkMessage);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const setTaskStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(taskStatusValues),
});
export type SetTaskStatusInput = z.infer<typeof setTaskStatusSchema>;

export const taskIdSchema = z.object({ id: z.string().uuid() });

export const listTasksSchema = z
  .object({
    mine: z.boolean().optional(),
    status: z.enum(taskStatusValues).optional(),
    entityType: z.enum(entityTypeValues).optional(),
    entityId: z.string().uuid().optional(),
  })
  .refine(createLinkComplete, linkMessage);
export type ListTasksInput = z.infer<typeof listTasksSchema>;

// ── Activities (unified timeline) ───────────────────────────────────────────
// addNote reuses the polymorphic entity ref; type is fixed to "note" (call/
// meeting/email activities are logged by their own modules later).
export const addNoteSchema = z.object({
  entityType: z.enum(entityTypeValues),
  entityId: z.string().uuid(),
  body: z.string().trim().min(1, "Note can't be empty").max(5000),
});
export type AddNoteInput = z.infer<typeof addNoteSchema>;
