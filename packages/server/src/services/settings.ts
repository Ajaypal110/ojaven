import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { agencies, agencySettings, db } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import {
  SUBDOMAIN_REGEX,
  isReservedSubdomain,
  normalizeSubdomain,
  type UpdateSettingsInput,
} from "@ojaven/shared";
import { lockKey } from "./agencyLock";

/** The settings row plus the agency name (which lives on `agencies`). */
export async function getSettings(agencyId: string) {
  const [row] = await db
    .select({
      settings: agencySettings,
      name: agencies.name,
    })
    .from(agencySettings)
    .innerJoin(agencies, eq(agencies.id, agencySettings.agencyId))
    .where(eq(agencySettings.agencyId, agencyId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Agency settings not found." });
  return { ...row.settings, name: row.name };
}

/**
 * Presence-based partial update — undefined = not sent, so untouched fields
 * are never clobbered; null clears the nullable columns (logoUrl,
 * primaryColor). `name` writes to `agencies`, everything else to
 * `agency_settings`, atomically in one transaction.
 */
export async function updateSettings(params: {
  agencyId: string;
  patch: UpdateSettingsInput;
}) {
  const { patch } = params;
  const set: Partial<typeof agencySettings.$inferInsert> = {};
  if (patch.logoUrl !== undefined) set.logoUrl = patch.logoUrl;
  if (patch.primaryColor !== undefined) set.primaryColor = patch.primaryColor;
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.currency !== undefined) set.currency = patch.currency;

  const hasSettings = Object.keys(set).length > 0;
  const hasName = patch.name !== undefined;
  if (!hasSettings && !hasName) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  return txDb.transaction(async (tx) => {
    if (hasName) {
      await tx.update(agencies).set({ name: patch.name }).where(eq(agencies.id, params.agencyId));
    }

    const [settingsRow] = hasSettings
      ? await tx
          .update(agencySettings)
          .set(set)
          .where(eq(agencySettings.agencyId, params.agencyId))
          .returning()
      : await tx
          .select()
          .from(agencySettings)
          .where(eq(agencySettings.agencyId, params.agencyId))
          .limit(1);

    if (!settingsRow) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Agency settings not found." });
    }

    const [agency] = await tx
      .select({ name: agencies.name })
      .from(agencies)
      .where(eq(agencies.id, params.agencyId))
      .limit(1);

    return { ...settingsRow, name: agency?.name ?? null };
  });
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505"
  );
}

/**
 * Change the agency's subdomain. Advisory-locked on the target subdomain
 * string so two agencies racing for the same value serialize; a taken value
 * surfaces as a readable CONFLICT, never a raw 23505. Format + reserved-word
 * validation happens at the router's Zod boundary; this owns the DB-level
 * uniqueness concern.
 */
export async function changeSubdomain(params: { agencyId: string; subdomain: string }) {
  const { agencyId, subdomain } = params;
  try {
    return await txDb.transaction(async (tx) => {
      await lockKey(tx, "subdomain", subdomain);

      const [taken] = await tx
        .select({ id: agencySettings.id })
        .from(agencySettings)
        .where(and(eq(agencySettings.subdomain, subdomain), ne(agencySettings.agencyId, agencyId)))
        .limit(1);
      if (taken) {
        throw new TRPCError({ code: "CONFLICT", message: "That subdomain is already taken." });
      }

      const [updated] = await tx
        .update(agencySettings)
        .set({ subdomain })
        .where(eq(agencySettings.agencyId, agencyId))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agency settings not found." });
      }
      return updated;
    });
  } catch (err) {
    // Backstop: any unique violation that slipped past the lock becomes the
    // same readable CONFLICT rather than a raw Postgres error.
    if (isUniqueViolation(err)) {
      throw new TRPCError({ code: "CONFLICT", message: "That subdomain is already taken." });
    }
    throw err;
  }
}

/**
 * Provision-path subdomain picker — used by agency JIT provisioning, which
 * must ALWAYS yield a valid, non-reserved, unique subdomain (there's no user
 * to reject to). Order: normalize the raw slug; if it's unusable (junk like a
 * mixed-case org id, or too short) fall back to a deterministic unique value;
 * if it's reserved, append an agency-derived suffix; if that or the base is
 * already taken, fall back to the guaranteed-unique value. The guaranteed
 * fallback keys on the agency id (a unique PK), so it can never collide.
 *
 * NOTE: this exists because provision previously stored `org.slug ??
 * clerkOrgId` raw — and clerkOrgId is mixed-case with an underscore, an
 * invalid subdomain silently persisted (no CHECK on the column). Same
 * mixed-case class as the tombstone-email bug.
 */
export async function pickProvisionSubdomain(
  dbc: typeof db | Tx,
  agencyId: string,
  rawSlug: string | null | undefined
): Promise<string> {
  const flat = agencyId.replace(/-/g, "");
  const guaranteed = `agency-${flat}`.slice(0, 63); // unique: agencyId is a PK
  const suffix = flat.slice(0, 8);

  let candidate = normalizeSubdomain(rawSlug ?? "");
  if (!candidate) return guaranteed; // nothing valid survived normalization

  if (isReservedSubdomain(candidate)) {
    candidate = `${candidate.slice(0, 54)}-${suffix}`.replace(/-+$/g, "");
    if (!SUBDOMAIN_REGEX.test(candidate)) return guaranteed;
  }

  const [taken] = await dbc
    .select({ id: agencySettings.id })
    .from(agencySettings)
    .where(eq(agencySettings.subdomain, candidate))
    .limit(1);
  return taken ? guaranteed : candidate;
}
