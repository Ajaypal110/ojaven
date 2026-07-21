import { z } from "zod";

// Shared field shapes, no defaults baked in — a default on a field survives
// z.object(...).partial() (it only makes the *key* optional; the field's own
// default still fires when the key is absent), which would silently reset
// isPrimary to false on every partial update that doesn't touch it. The
// default lives ONLY on createContactSchema, where it's actually wanted.
// (Same lesson as clientFields.)
const contactFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  // Lowercased here so the DB's client_contacts_email_lowercase CHECK is a
  // backstop we never actually hit — same move as subdomain normalization.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .max(255)
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  title: z.string().trim().max(150).optional().or(z.literal("")),
  isPrimary: z.boolean(),
};

export const createContactSchema = z.object({
  clientId: z.string().uuid(),
  ...contactFields,
  isPrimary: contactFields.isPrimary.default(false),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

// clientId is intentionally absent: a contact can't be reparented to another
// client via update.
export const updateContactSchema = z.object(contactFields).partial();

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
