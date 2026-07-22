import { z } from "zod";

// "YYYY-MM" (a reporting month) and "YYYY-MM-DD" (a calendar entry date).
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const isRealDate = (s: string) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const monthField = z.string().regex(MONTH_REGEX, "Use YYYY-MM");
const dateField = z
  .string()
  .regex(DATE_REGEX, "Use YYYY-MM-DD")
  .refine(isRealDate, "Not a real date");

// ── Time entries ────────────────────────────────────────────────────────────
// No defaults on the shared field shapes (a default surviving .partial() would
// silently reset). isBillable default lives only on the create schema.
const entryFields = {
  hours: z.number().positive("Hours must be positive").max(24, "One entry can't exceed 24 hours"),
  entryDate: dateField, // future-vs-today is validated in the service (agency timezone)
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  taskId: z.string().uuid().optional().nullable(),
  isBillable: z.boolean(),
};

export const logTimeEntrySchema = z.object({
  clientId: z.string().uuid(),
  ...entryFields,
  isBillable: entryFields.isBillable.default(true),
});
export type LogTimeEntryInput = z.infer<typeof logTimeEntrySchema>;

// clientId is intentionally absent: an entry's client is its identity (it was
// logged against that client). To move it, delete + re-log.
export const updateTimeEntrySchema = z.object({ id: z.string().uuid() }).merge(
  z.object(entryFields).partial()
);
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

export const timeEntryIdSchema = z.object({ id: z.string().uuid() });

// month optional -> service defaults to the current month in the agency's tz.
export const listByClientSchema = z.object({
  clientId: z.string().uuid(),
  month: monthField.optional(),
});
export type ListByClientInput = z.infer<typeof listByClientSchema>;

export const monthlyRollupSchema = z.object({
  clientId: z.string().uuid(),
  month: monthField.optional(),
});
export type MonthlyRollupInput = z.infer<typeof monthlyRollupSchema>;

// ── Retainers ───────────────────────────────────────────────────────────────
// effectiveFrom must be the 1st of a month, so every calendar month maps to
// exactly one retainer (no mid-month split / proration).
const firstOfMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Retainers take effect on the 1st of a month")
  .refine(isRealDate, "Not a real date");

export const setRetainerSchema = z.object({
  clientId: z.string().uuid(),
  hoursPerMonth: z.number().positive("Hours must be positive").max(9999.99),
  effectiveFrom: firstOfMonth,
});
export type SetRetainerInput = z.infer<typeof setRetainerSchema>;

export const clientRetainerSchema = z.object({ clientId: z.string().uuid() });
