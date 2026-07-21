import { z } from "zod";

// Independent copies of the DB enums (same convention as clientStatusValues) —
// shared is a leaf package and can't import from @ojaven/db.
export const entityTypeValues = [
  "client",
  "client_contact",
  "deal",
  "task",
  "proposal",
  "invoice",
  "content_item",
] as const;
export type EntityType = (typeof entityTypeValues)[number];

export const fieldTypeValues = ["text", "number", "date", "boolean", "select", "url"] as const;
export type FieldType = (typeof fieldTypeValues)[number];

// Entity types A3 actually supports for tag/custom-field definitions + values.
// The service (assertEntityLive / assertSupportedEntityType) backstops this;
// keeping the list here documents the scope in one place.
export const supportedEntityTypeValues = ["client", "client_contact", "deal"] as const;

// A polymorphic entity reference. Zod accepts ALL entity-type enum members —
// the "not available yet" rejection for unbuilt types is a service-level
// message (clearer than a generic Zod enum error).
const entityRef = {
  entityType: z.enum(entityTypeValues),
  entityId: z.string().uuid(),
};
export const entityRefSchema = z.object(entityRef);
export type EntityRefInput = z.infer<typeof entityRefSchema>;

// ── Tags ──────────────────────────────────────────────────────────────────
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #3B82F6");

// Shared field shapes — no defaults baked in (a default surviving a partial
// update silently resets; the recurring lesson). color: empty string = clear.
const tagFields = {
  name: z.string().trim().min(1, "Name is required").max(60),
  color: hexColor.optional().or(z.literal("")),
};

export const createTagSchema = z.object(tagFields);
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({ id: z.string().uuid(), ...tagFields });
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const tagIdSchema = z.object({ id: z.string().uuid() });

// attach + detach share this shape (tag + target entity).
export const tagAttachmentSchema = z.object({ tagId: z.string().uuid(), ...entityRef });
export type TagAttachmentInput = z.infer<typeof tagAttachmentSchema>;

// ── Custom fields ───────────────────────────────────────────────────────────
const customFieldFields = {
  name: z.string().trim().min(1, "Name is required").max(100),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  isRequired: z.boolean(),
  sortOrder: z.number().int().min(0),
};

export const createCustomFieldSchema = z
  .object({
    entityType: z.enum(entityTypeValues),
    fieldType: z.enum(fieldTypeValues),
    ...customFieldFields,
    // Defaults live ONLY on create (never survive into the partial update).
    isRequired: customFieldFields.isRequired.default(false),
    sortOrder: customFieldFields.sortOrder.default(0),
  })
  .refine((v) => v.fieldType !== "select" || (v.options != null && v.options.length > 0), {
    message: "A select field needs at least one option.",
    path: ["options"],
  });
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

// entityType + fieldType are intentionally absent: retyping a field or moving
// it to another entity type would corrupt existing values.
export const updateCustomFieldSchema = z
  .object({ id: z.string().uuid() })
  .merge(z.object(customFieldFields).partial());
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;

export const customFieldIdSchema = z.object({ id: z.string().uuid() });

export const listFieldsForEntityTypeSchema = z.object({ entityType: z.enum(entityTypeValues) });

// value: a string (typed value) or null (clear). Per-fieldType validation is
// dynamic (depends on the field row's fieldType + options), so it lives in the
// service — Zod only bounds the raw length here.
export const setFieldValueSchema = z.object({
  customFieldId: z.string().uuid(),
  ...entityRef,
  value: z.string().max(10000).nullable(),
});
export type SetFieldValueInput = z.infer<typeof setFieldValueSchema>;
