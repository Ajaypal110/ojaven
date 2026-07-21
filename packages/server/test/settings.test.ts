import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { agencySettings, db } from "@ojaven/db";
import {
  changeSubdomainSchema,
  isReservedSubdomain,
  normalizeSubdomain,
} from "@ojaven/shared";
import { assertStructureRole } from "../src/roleGuards";
import {
  changeSubdomain,
  getSettings,
  pickProvisionSubdomain,
  updateSettings,
} from "../src/services/settings";
import { cleanupAgencies, seedAgency } from "./helpers";

const agencyIds: string[] = [];
afterAll(async () => cleanupAgencies(agencyIds));

/** Agency + a settings row with a random unique subdomain. */
async function seedWithSettings(overrides: Partial<typeof agencySettings.$inferInsert> = {}) {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  const [settings] = await db
    .insert(agencySettings)
    .values({ agencyId: agency.id, subdomain: `sub-${randomUUID().slice(0, 12)}`, ...overrides })
    .returning();
  return { agency, settings: settings! };
}

describe("assertStructureRole (shared structure gate)", () => {
  it("allows owner and admin, refuses manager and operator", () => {
    expect(() => assertStructureRole("owner", "agency settings")).not.toThrow();
    expect(() => assertStructureRole("admin", "agency settings")).not.toThrow();
    expect(() => assertStructureRole("manager", "agency settings")).toThrow(/Only owners and admins/);
    expect(() => assertStructureRole("operator", "agency settings")).toThrow(/Only owners and admins/);
  });
});

describe("getSettings / updateSettings", () => {
  it("returns the row; partial update doesn't clobber untouched fields", async () => {
    const { agency } = await seedWithSettings({ timezone: "UTC", currency: "USD" });

    const got = await getSettings(agency.id);
    expect(got.timezone).toBe("UTC");

    // Update only timezone — currency must survive.
    const updated = await updateSettings({
      agencyId: agency.id,
      patch: { timezone: "America/New_York" },
    });
    expect(updated.timezone).toBe("America/New_York");
    expect(updated.currency).toBe("USD"); // untouched

    // Clearing a nullable field with explicit null.
    const cleared = await updateSettings({ agencyId: agency.id, patch: { logoUrl: null } });
    expect(cleared.logoUrl).toBeNull();
    expect(cleared.timezone).toBe("America/New_York"); // still untouched
  });

  it("rejects an empty patch", async () => {
    const { agency } = await seedWithSettings();
    await expect(updateSettings({ agencyId: agency.id, patch: {} })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("changeSubdomain", () => {
  it("changes to a free subdomain", async () => {
    const { agency } = await seedWithSettings();
    const target = `fresh-${randomUUID().slice(0, 12)}`;
    const updated = await changeSubdomain({ agencyId: agency.id, subdomain: target });
    expect(updated.subdomain).toBe(target);
  });

  it("refuses a subdomain taken by another agency with a readable CONFLICT", async () => {
    const taken = `taken-${randomUUID().slice(0, 12)}`;
    await seedWithSettings({ subdomain: taken });
    const { agency: other } = await seedWithSettings();

    await expect(
      changeSubdomain({ agencyId: other.id, subdomain: taken })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "That subdomain is already taken." });
  });

  it("lets an agency 're-set' its own current subdomain (not a false conflict)", async () => {
    const mine = `mine-${randomUUID().slice(0, 12)}`;
    const { agency } = await seedWithSettings({ subdomain: mine });
    const updated = await changeSubdomain({ agencyId: agency.id, subdomain: mine });
    expect(updated.subdomain).toBe(mine);
  });
});

describe("changeSubdomainSchema (format + reserved, Zod boundary)", () => {
  it("rejects reserved words", () => {
    for (const reserved of ["admin", "accounts", "api", "account", "posthog", "ns1"]) {
      expect(changeSubdomainSchema.safeParse({ subdomain: reserved }).success).toBe(false);
      expect(isReservedSubdomain(reserved)).toBe(true);
    }
  });
  it("rejects bad format, accepts a clean one, lowercases input", () => {
    expect(changeSubdomainSchema.safeParse({ subdomain: "ab" }).success).toBe(false); // too short
    expect(changeSubdomainSchema.safeParse({ subdomain: "-lead" }).success).toBe(false); // leading hyphen
    expect(changeSubdomainSchema.safeParse({ subdomain: "a_b" }).success).toBe(false); // underscore
    const ok = changeSubdomainSchema.safeParse({ subdomain: "Acme-Co" });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.subdomain).toBe("acme-co"); // lowercased
  });
});

describe("normalizeSubdomain (provision helper, pure)", () => {
  it("normalizes valid, empties the unsalvageable", () => {
    expect(normalizeSubdomain("Acme Digital!!")).toBe("acme-digital");
    expect(normalizeSubdomain("org_3GRsay1ewiWvkFnhMEPGDJZwra7")).toBe(
      "org-3grsay1ewiwvkfnhmepgdjzwra7"
    );
    expect(normalizeSubdomain("!!")).toBe(""); // nothing valid survives
    expect(normalizeSubdomain("ab")).toBe(""); // too short after normalize
  });
});

describe("pickProvisionSubdomain (always valid, non-reserved, unique)", () => {
  it("keeps a clean slug", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);
    expect(await pickProvisionSubdomain(db, agency.id, "acme-agency")).toBe("acme-agency");
  });

  it("suffixes a reserved slug", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);
    const result = await pickProvisionSubdomain(db, agency.id, "admin");
    expect(result).toMatch(/^admin-[0-9a-f]{8}$/);
    expect(isReservedSubdomain(result)).toBe(false);
  });

  it("falls back to agency-<id> for junk (mixed-case org id) and for a taken candidate", async () => {
    const agency = await seedAgency();
    agencyIds.push(agency.id);
    const flat = agency.id.replace(/-/g, "");

    // Junk: an org id normalizes to something, but let's force the empty path
    // with pure punctuation, which yields "" -> guaranteed fallback.
    expect(await pickProvisionSubdomain(db, agency.id, "!!!")).toBe(`agency-${flat}`.slice(0, 63));

    // Taken: seed a settings row holding the exact normalized candidate.
    const other = await seedAgency();
    agencyIds.push(other.id);
    await db.insert(agencySettings).values({ agencyId: other.id, subdomain: "contested" });
    expect(await pickProvisionSubdomain(db, agency.id, "contested")).toBe(
      `agency-${flat}`.slice(0, 63)
    );
  });
});
