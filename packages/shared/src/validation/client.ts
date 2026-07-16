import { z } from "zod";

export const clientStatusValues = ["prospect", "active", "paused", "churned"] as const;

// Shared field shapes, no defaults baked in — a default on a field survives
// z.object(...).partial() (it only makes the *key* optional, the field's
// own default still fires when the key is absent), which would silently
// reset status to "prospect" on every partial update that doesn't touch it.
// Defaults are applied only where that's actually wanted: createClientSchema.
const clientFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  website: z
    .string()
    .trim()
    .url("Enter a full URL, e.g. https://example.com")
    .max(500)
    .optional()
    .or(z.literal("")),
  industry: z.string().trim().max(200).optional().or(z.literal("")),
  status: z.enum(clientStatusValues),
};

export const createClientSchema = z.object({
  ...clientFields,
  status: clientFields.status.default("prospect"),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.object(clientFields).partial();

export type UpdateClientInput = z.infer<typeof updateClientSchema>;
