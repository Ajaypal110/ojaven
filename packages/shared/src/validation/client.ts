import { z } from "zod";

export const clientStatusValues = ["prospect", "active", "paused", "churned"] as const;

export const createClientSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  website: z
    .string()
    .trim()
    .url("Enter a full URL, e.g. https://example.com")
    .max(500)
    .optional()
    .or(z.literal("")),
  industry: z.string().trim().max(200).optional().or(z.literal("")),
  status: z.enum(clientStatusValues).default("prospect"),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
