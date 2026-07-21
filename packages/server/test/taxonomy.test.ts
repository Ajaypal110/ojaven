import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clientContacts, clients, customFieldValues, db, deals, entityTags } from "@ojaven/db";
import { assertStructureRole } from "../src/roleGuards";
import { createCustomFieldSchema } from "@ojaven/shared";
import {
  attachTag,
  createTag,
  deleteTag,
  detachTag,
  listTagsForEntity,
  updateTag,
} from "../src/services/tags";
import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  listFieldValuesForEntity,
  setFieldValue,
  validateFieldValue,
} from "../src/services/customFields";
import { ensureDefaultPipeline, listPipelines } from "../src/services/pipeline";
import { cleanupAgencies, seedAgency } from "./helpers";

// Deleting the agency cascades every A3 table (all reference agencyId onDelete
// cascade), plus clients/contacts/deals/pipelines.
const agencyIds: string[] = [];
afterAll(async () => cleanupAgencies(agencyIds));

async function freshAgency() {
  const agency = await seedAgency();
  agencyIds.push(agency.id);
  return agency;
}

async function seedClient(agencyId: string, name = "Acme Co") {
  const [client] = await db.insert(clients).values({ agencyId, name }).returning();
  return client!;
}

async function seedContact(agencyId: string, clientId: string) {
  const [row] = await db
    .insert(clientContacts)
    .values({ agencyId, clientId, firstName: "Con" })
    .returning();
  return row!;
}

async function seedDeal(agencyId: string, clientId: string) {
  const { pipeline } = await ensureDefaultPipeline(agencyId);
  const [withStages] = await listPipelines(agencyId);
  const stageId = withStages!.stages[0]!.id;
  const [row] = await db
    .insert(deals)
    .values({ agencyId, clientId, pipelineId: pipeline.id, stageId, name: "Deal" })
    .returning();
  return row!;
}

function fieldInput(fieldType: string, over: Record<string, unknown> = {}) {
  return createCustomFieldSchema.parse({
    entityType: "client",
    name: `${fieldType}-field`,
    fieldType,
    ...over,
  });
}

// ── The safety net: assertEntityLive is the SOLE tenant-isolation + liveness
//    guard on the polymorphic writes (no FK backstops it). Hammer it. ─────────
describe("assertEntityLive (sole tenant/liveness guard — no FK behind it)", () => {
  it("cross-agency: agency A can't tag agency B's client uuid", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const tag = await createTag({ agencyId: a.id, input: { name: "A-tag" } });
    const bClient = await seedClient(b.id);

    await expect(
      attachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client", entityId: bClient.id },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("soft-deleted entity: can't tag a soft-deleted client", async () => {
    const a = await freshAgency();
    const tag = await createTag({ agencyId: a.id, input: { name: "t" } });
    const client = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));

    await expect(
      attachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client", entityId: client.id },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("wrong entityType for uuid: 'client' + a deal's uuid misses the client lookup", async () => {
    const a = await freshAgency();
    const tag = await createTag({ agencyId: a.id, input: { name: "t" } });
    const client = await seedClient(a.id);
    const deal = await seedDeal(a.id, client.id);

    await expect(
      attachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client", entityId: deal.id },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("contact/deal of a soft-deleted client are unreachable (parent-live rule)", async () => {
    const a = await freshAgency();
    const tag = await createTag({ agencyId: a.id, input: { name: "t" } });
    const client = await seedClient(a.id);
    const contact = await seedContact(a.id, client.id);
    const deal = await seedDeal(a.id, client.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));

    await expect(
      attachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client_contact", entityId: contact.id },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      attachTag({ agencyId: a.id, input: { tagId: tag!.id, entityType: "deal", entityId: deal.id } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unbuilt entity types are refused with a clear 'not available yet'", async () => {
    const a = await freshAgency();
    const tag = await createTag({ agencyId: a.id, input: { name: "t" } });
    await expect(
      attachTag({
        agencyId: a.id,
        input: {
          tagId: tag!.id,
          entityType: "invoice",
          entityId: "11111111-1111-1111-1111-111111111111",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /not available for invoice yet/ });
  });
});

// ── Polymorphic routing: the same tag lands independently on different types.
describe("tag attach — polymorphic routing", () => {
  it("routes attachments per entity; the same tag on client and deal are independent", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const deal = await seedDeal(a.id, client.id);
    const shared = await createTag({ agencyId: a.id, input: { name: "shared" } });
    const clientOnly = await createTag({ agencyId: a.id, input: { name: "client-only" } });

    await attachTag({
      agencyId: a.id,
      input: { tagId: shared!.id, entityType: "client", entityId: client.id },
    });
    await attachTag({
      agencyId: a.id,
      input: { tagId: shared!.id, entityType: "deal", entityId: deal.id },
    });
    await attachTag({
      agencyId: a.id,
      input: { tagId: clientOnly!.id, entityType: "client", entityId: client.id },
    });

    const onClient = await listTagsForEntity({
      agencyId: a.id,
      entityType: "client",
      entityId: client.id,
    });
    const onDeal = await listTagsForEntity({
      agencyId: a.id,
      entityType: "deal",
      entityId: deal.id,
    });
    expect(onClient.map((t) => t.name).sort()).toEqual(["client-only", "shared"]);
    expect(onDeal.map((t) => t.name)).toEqual(["shared"]); // client-only tag did NOT leak onto the deal
  });

  it("attach is idempotent (re-attaching is a no-op, one row)", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const tag = await createTag({ agencyId: a.id, input: { name: "dup" } });

    for (let i = 0; i < 3; i++) {
      await attachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client", entityId: client.id },
      });
    }
    const rows = await db
      .select()
      .from(entityTags)
      .where(and(eq(entityTags.tagId, tag!.id), eq(entityTags.entityId, client.id)));
    expect(rows).toHaveLength(1);
  });

  it("detach removes the link and is idempotent", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const tag = await createTag({ agencyId: a.id, input: { name: "x" } });
    await attachTag({
      agencyId: a.id,
      input: { tagId: tag!.id, entityType: "client", entityId: client.id },
    });

    await detachTag({
      agencyId: a.id,
      input: { tagId: tag!.id, entityType: "client", entityId: client.id },
    });
    expect(
      await listTagsForEntity({ agencyId: a.id, entityType: "client", entityId: client.id })
    ).toHaveLength(0);
    // Second detach: no throw.
    await expect(
      detachTag({
        agencyId: a.id,
        input: { tagId: tag!.id, entityType: "client", entityId: client.id },
      })
    ).resolves.toEqual({ detached: true });
  });
});

// ── Tag definitions: uniqueness scoping, cascade delete.
describe("tag definitions", () => {
  it("name is unique per agency (readable CONFLICT), reusable across agencies", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    await createTag({ agencyId: a.id, input: { name: "VIP" } });
    await expect(createTag({ agencyId: a.id, input: { name: "VIP" } })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Different agency, same name — fine.
    await expect(createTag({ agencyId: b.id, input: { name: "VIP" } })).resolves.toBeDefined();
  });

  it("rename + recolor; delete cascades its attachments", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const tag = await createTag({ agencyId: a.id, input: { name: "old", color: "#111111" } });
    await attachTag({
      agencyId: a.id,
      input: { tagId: tag!.id, entityType: "client", entityId: client.id },
    });

    const renamed = await updateTag({
      agencyId: a.id,
      id: tag!.id,
      input: { name: "new", color: "#222222" },
    });
    expect(renamed.name).toBe("new");
    expect(renamed.color).toBe("#222222");

    await deleteTag({ agencyId: a.id, id: tag!.id });
    // FK cascade removed the entityTags row.
    const rows = await db.select().from(entityTags).where(eq(entityTags.tagId, tag!.id));
    expect(rows).toHaveLength(0);
  });
});

// ── Custom field definitions + the dynamic value-validation matrix.
describe("custom field definitions", () => {
  it("stores options only for select; lists in sortOrder", async () => {
    const a = await freshAgency();
    const text = await createCustomField({ agencyId: a.id, input: fieldInput("text", { sortOrder: 1 }) });
    const sel = await createCustomField({
      agencyId: a.id,
      input: fieldInput("select", { sortOrder: 0, options: ["a", "b"] }),
    });
    expect(text!.options).toBeNull();
    expect(sel!.options).toEqual(["a", "b"]);

    const listed = await listCustomFields({ agencyId: a.id, entityType: "client" });
    expect(listed.map((f) => f.fieldType)).toEqual(["select", "text"]); // sortOrder 0, then 1
  });

  it("Zod refine: a select field requires a non-empty options array", () => {
    expect(
      createCustomFieldSchema.safeParse({
        entityType: "client",
        name: "S",
        fieldType: "select",
      }).success
    ).toBe(false);
    expect(
      createCustomFieldSchema.safeParse({
        entityType: "client",
        name: "S",
        fieldType: "select",
        options: [],
      }).success
    ).toBe(false);
    expect(
      createCustomFieldSchema.safeParse({
        entityType: "client",
        name: "S",
        fieldType: "select",
        options: ["x"],
      }).success
    ).toBe(true);
  });

  it("delete cascades its values", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const field = await createCustomField({ agencyId: a.id, input: fieldInput("text") });
    await setFieldValue({
      agencyId: a.id,
      input: { customFieldId: field!.id, entityType: "client", entityId: client.id, value: "hi" },
    });

    await deleteCustomField({ agencyId: a.id, id: field!.id });
    const rows = await db
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.customFieldId, field!.id));
    expect(rows).toHaveLength(0);
  });
});

describe("validateFieldValue (per-fieldType matrix, pure)", () => {
  it("accepts valid, canonicalizes, rejects invalid", () => {
    expect(validateFieldValue("text", null, "anything")).toBe("anything");
    expect(validateFieldValue("number", null, "12.50")).toBe("12.5"); // canonical
    expect(() => validateFieldValue("number", null, "abc")).toThrow(/number/);
    expect(validateFieldValue("boolean", null, "true")).toBe("true");
    expect(() => validateFieldValue("boolean", null, "yes")).toThrow();
    expect(validateFieldValue("date", null, "2026-07-21")).toBe("2026-07-21");
    expect(() => validateFieldValue("date", null, "not-a-date")).toThrow();
    expect(validateFieldValue("url", null, "https://ojaven.com")).toBe("https://ojaven.com");
    expect(() => validateFieldValue("url", null, "nope")).toThrow();
    expect(validateFieldValue("select", ["a", "b"], "a")).toBe("a");
    expect(() => validateFieldValue("select", ["a", "b"], "c")).toThrow();
  });
});

describe("setFieldValue — upsert, clear, guards", () => {
  it("upserts (one row), then clears (row deleted)", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const field = await createCustomField({ agencyId: a.id, input: fieldInput("text") });
    const ref = { customFieldId: field!.id, entityType: "client" as const, entityId: client.id };

    await setFieldValue({ agencyId: a.id, input: { ...ref, value: "one" } });
    await setFieldValue({ agencyId: a.id, input: { ...ref, value: "two" } });

    let values = await listFieldValuesForEntity({
      agencyId: a.id,
      entityType: "client",
      entityId: client.id,
    });
    expect(values).toHaveLength(1);
    expect(values[0]?.value).toBe("two"); // updated, not duplicated

    const rows = await db
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.customFieldId, field!.id));
    expect(rows).toHaveLength(1);

    // Clear -> row deleted, field still listed with a null value.
    await setFieldValue({ agencyId: a.id, input: { ...ref, value: null } });
    values = await listFieldValuesForEntity({
      agencyId: a.id,
      entityType: "client",
      entityId: client.id,
    });
    expect(values[0]?.value).toBeNull();
  });

  it("rejects a value for a field whose entityType doesn't match the target", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const deal = await seedDeal(a.id, client.id);
    const clientField = await createCustomField({ agencyId: a.id, input: fieldInput("text") });

    await expect(
      setFieldValue({
        agencyId: a.id,
        input: {
          customFieldId: clientField!.id,
          entityType: "deal",
          entityId: deal.id,
          value: "x",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /doesn't apply/ });
  });

  it("validates the typed value end-to-end (select rejects an off-list value)", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const sel = await createCustomField({
      agencyId: a.id,
      input: fieldInput("select", { options: ["gold", "silver"] }),
    });
    await expect(
      setFieldValue({
        agencyId: a.id,
        input: {
          customFieldId: sel!.id,
          entityType: "client",
          entityId: client.id,
          value: "bronze",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      setFieldValue({
        agencyId: a.id,
        input: { customFieldId: sel!.id, entityType: "client", entityId: client.id, value: "gold" },
      })
    ).resolves.toBeDefined();
  });
});

describe("structure-role gate (definitions are owner/admin only)", () => {
  it("assertStructureRole allows owner/admin, refuses manager/operator for tags + fields", () => {
    for (const resource of ["tags", "custom fields"]) {
      expect(() => assertStructureRole("owner", resource)).not.toThrow();
      expect(() => assertStructureRole("admin", resource)).not.toThrow();
      expect(() => assertStructureRole("manager", resource)).toThrow(/Only owners and admins/);
      expect(() => assertStructureRole("operator", resource)).toThrow(/Only owners and admins/);
    }
  });
});
