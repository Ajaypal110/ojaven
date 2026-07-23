import { z } from "zod";

export const contentStatusValues = ["draft", "in_review", "approved", "rejected", "published"] as const;
export type ContentStatus = (typeof contentStatusValues)[number];

// contentType is deliberately free text (agency-extensible per the schema);
// blog/ad/social are UI suggestions, not an enum.
const contentTypeField = z.string().trim().min(1, "Type is required").max(50);

const contentFields = {
  title: z.string().trim().min(1, "Title is required").max(300),
  body: z.string().max(100_000).optional().or(z.literal("")),
  contentType: contentTypeField,
};

// clientId is identity — set at create, never updated.
export const createContentSchema = z.object({
  clientId: z.string().uuid(),
  ...contentFields,
});
export type CreateContentInput = z.infer<typeof createContentSchema>;

export const updateContentSchema = z
  .object({ id: z.string().uuid() })
  .merge(z.object(contentFields).partial());
export type UpdateContentInput = z.infer<typeof updateContentSchema>;

export const contentIdSchema = z.object({ id: z.string().uuid() });

// note optional on reject BY DESIGN — requiring it produces "asdf". The UI
// encourages; the schema doesn't enforce.
export const reviewContentSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type ReviewContentInput = z.infer<typeof reviewContentSchema>;

export const listContentSchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(contentStatusValues).optional(),
  contentType: contentTypeField.optional(),
});
export type ListContentInput = z.infer<typeof listContentSchema>;
