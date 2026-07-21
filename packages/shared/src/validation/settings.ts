import { z } from "zod";

/** 3–63 chars, lowercase alphanumeric + hyphen, no leading/trailing hyphen. */
export const SUBDOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Subdomains a customer may NOT claim. Guards customer claims against
 * collisions with Ojaven's own infrastructure and generic sensitive names.
 *
 * NOTE (logged in KNOWN_ITEMS): this denylist is belt-and-suspenders. The
 * actual routing protection for auth/cert-critical names (accounts, clerk,
 * _acme-challenge) is DNS wildcard-vs-specific-record precedence, set up at
 * the portal/Clerk-prod stage — a specific `accounts.ojaven.com` record
 * wins over the `*.ojaven.com` wildcard regardless of this list.
 *
 * The format rule already blocks every underscore-prefixed DNS record
 * (_dmarc, _domainkey, _acme-challenge, _vercel, _mta-sts); this covers the
 * plain labels that could pass format validation.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  // routing / auth / cert-critical
  "clerk", "accounts", "clkmail", "clk", "send", "resend", "bounces",
  "acme-challenge", "acme", "cname", "vercel", "mta-sts", "autodiscover",
  "autoconfig",
  // Ojaven product / marketing surfaces
  "www", "ojaven", "app", "dashboard", "portal", "admin", "superadmin",
  "console", "panel", "internal", "ops", "staff", "backoffice", "root",
  "system", "sys",
  // API / service names
  "api", "graphql", "trpc", "rpc", "ws", "websocket", "webhook", "webhooks",
  "hooks", "oauth", "auth", "sso", "login", "signin", "signup", "register",
  "logout", "verify", "callback", "token",
  // infra / assets / email
  "cdn", "static", "assets", "img", "images", "media", "files", "download",
  "downloads", "uploads", "storage", "r2", "s3", "mail", "email", "smtp",
  "imap", "pop", "mx", "webmail", "mailer", "notifications", "notify",
  "alerts", "unsubscribe",
  // environments
  "staging", "stage", "dev", "development", "test", "testing", "qa", "uat",
  "preview", "sandbox", "demo", "beta", "alpha", "canary", "edge", "next",
  "local", "localhost",
  // billing / vendor defensive
  "billing", "pay", "payments", "checkout", "stripe", "status", "help",
  "support", "docs", "blog", "security", "legal", "privacy", "terms",
  // review additions: short-link labels
  "m", "l", "go", "link", "links", "url", "s", "short",
  // review additions: nameserver / mail numbering
  "ns", "ns1", "ns2", "dns", "mail1", "mx1", "mx2",
  // review additions: identity (note "account" singular — near-miss on "accounts")
  "id", "identity", "account", "profile", "me", "user", "users",
  // review additions: observability
  "errors", "sentry", "logs", "metrics", "analytics", "posthog", "telemetry",
]);

export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

/**
 * Coerce arbitrary text (a Clerk org slug, an org id) into a valid-format
 * subdomain candidate, or "" if nothing valid survives. Used ONLY by the
 * provision path, which must always produce something and falls back to a
 * deterministic unique value when this yields an unusable result — never by
 * changeSubdomain, which rejects invalid input outright.
 */
export function normalizeSubdomain(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return SUBDOMAIN_REGEX.test(normalized) ? normalized : "";
}

export const changeSubdomainSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(63, "At most 63 characters")
    .regex(SUBDOMAIN_REGEX, "Lowercase letters, numbers, and hyphens only")
    .refine((value) => !isReservedSubdomain(value), "That subdomain is reserved"),
});
export type ChangeSubdomainInput = z.infer<typeof changeSubdomainSchema>;

const TIMEZONES: ReadonlySet<string> = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
);

/**
 * Partial settings update — no baked defaults (the updateClientSchema
 * lesson: a field default survives .partial() and silently resets on
 * updates that don't send the key). subdomain/customDomain are deliberately
 * NOT here: subdomain goes through changeSubdomain; customDomain is portal
 * scope (C1). logoUrl is a bare URL until R2 makes it a real upload.
 */
export const updateSettingsSchema = z.object({
  // name lives on `agencies`, not `agency_settings` — updateSettings writes
  // it cross-table in one transaction. Included here so the settings form is
  // a single save.
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #D97706")
    .nullable()
    .optional(),
  // timezone/currency are NOT NULL columns — omittable, not clearable.
  timezone: z
    .string()
    .refine((tz) => TIMEZONES.size === 0 || TIMEZONES.has(tz), "Unknown time zone")
    .optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO 4217 code"))
    .optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
