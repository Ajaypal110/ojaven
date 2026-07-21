import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { clientContacts, clients, db } from "@ojaven/db";
import {
  createContactSchema,
  updateContactSchema,
  type CreateContactInput,
} from "@ojaven/shared";
import {
  createContact,
  deleteContact,
  listContactsByClient,
  updateContact,
} from "../src/services/contacts";
import { cleanupAgencies, seedAgency } from "./helpers";

// Deleting the agency cascades clients + client_contacts (both FK onDelete
// cascade to agencies), so tracking agencyIds is enough to clean everything.
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

/** A minimal valid create input; override any field. */
function mkCreate(clientId: string, over: Partial<CreateContactInput> = {}): CreateContactInput {
  return { clientId, firstName: "Ann", isPrimary: false, ...over };
}

async function livePrimaries(agencyId: string, clientId: string) {
  return db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.agencyId, agencyId),
        eq(clientContacts.clientId, clientId),
        eq(clientContacts.isPrimary, true),
        isNull(clientContacts.deletedAt)
      )
    );
}

describe("createContact / listContactsByClient (happy path)", () => {
  it("creates a contact and lists it back", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);

    const created = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "Grace", lastName: "Hopper", title: "CTO" }),
    });
    expect(created?.firstName).toBe("Grace");
    expect(created?.isPrimary).toBe(false);

    const list = await listContactsByClient(agency.id, client.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.lastName).toBe("Hopper");
  });

  it("empty-string optional fields become null (presence convention)", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const created = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { email: "", phone: "", title: "" }),
    });
    expect(created?.email).toBeNull();
    expect(created?.phone).toBeNull();
    expect(created?.title).toBeNull();
  });

  it("orders primary first, then oldest", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    await createContact({ agencyId: agency.id, input: mkCreate(client.id, { firstName: "First" }) });
    await createContact({ agencyId: agency.id, input: mkCreate(client.id, { firstName: "Second" }) });
    await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "Boss", isPrimary: true }),
    });

    const list = await listContactsByClient(agency.id, client.id);
    expect(list.map((c) => c.firstName)).toEqual(["Boss", "First", "Second"]);
  });
});

describe("updateContact / deleteContact", () => {
  it("presence-based partial update doesn't clobber untouched fields", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const created = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "Ada", lastName: "Lovelace", title: "Analyst" }),
    });

    const updated = await updateContact({
      agencyId: agency.id,
      id: created!.id,
      input: { title: "Lead Analyst" },
    });
    expect(updated?.title).toBe("Lead Analyst");
    expect(updated?.firstName).toBe("Ada"); // untouched
    expect(updated?.lastName).toBe("Lovelace"); // untouched
  });

  it("rejects an empty patch with BAD_REQUEST", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const created = await createContact({ agencyId: agency.id, input: mkCreate(client.id) });

    await expect(
      updateContact({ agencyId: agency.id, id: created!.id, input: {} })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("soft-deletes — the row leaves the list but stays in the table", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const created = await createContact({ agencyId: agency.id, input: mkCreate(client.id) });

    const res = await deleteContact({ agencyId: agency.id, id: created!.id });
    expect(res.id).toBe(created!.id);
    expect(await listContactsByClient(agency.id, client.id)).toHaveLength(0);

    const [row] = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, created!.id));
    expect(row?.deletedAt).not.toBeNull(); // soft, not hard
  });
});

describe("parent-client-live guard (all four ops)", () => {
  it("create / list refuse a soft-deleted client", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));

    await expect(
      createContact({ agencyId: agency.id, input: mkCreate(client.id) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listContactsByClient(agency.id, client.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("update / delete refuse a contact whose client was soft-deleted after creation", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const created = await createContact({ agencyId: agency.id, input: mkCreate(client.id) });
    // Soft-deleting the client does NOT cascade to the contact...
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));

    // ...but the join-guard makes it unreachable anyway.
    await expect(
      updateContact({ agencyId: agency.id, id: created!.id, input: { firstName: "X" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      deleteContact({ agencyId: agency.id, id: created!.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("agency isolation", () => {
  it("another agency can't read, update, or delete the contact", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const clientA = await seedClient(a.id);
    const contact = await createContact({ agencyId: a.id, input: mkCreate(clientA.id) });

    // B doesn't own clientA -> listByClient guard fails at the client.
    await expect(listContactsByClient(b.id, clientA.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // B addressing A's contact id -> agency-scoped guard fails at the contact.
    await expect(
      updateContact({ agencyId: b.id, id: contact!.id, input: { firstName: "Hijack" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      deleteContact({ agencyId: b.id, id: contact!.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A's contact is untouched.
    const [row] = await db.select().from(clientContacts).where(eq(clientContacts.id, contact!.id));
    expect(row?.firstName).toBe("Ann");
    expect(row?.deletedAt).toBeNull();
  });

  it("create refuses a clientId belonging to another agency", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const clientA = await seedClient(a.id);
    await expect(
      createContact({ agencyId: b.id, input: mkCreate(clientA.id) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("isPrimary — at most one primary per client", () => {
  it("a second primary via create demotes the first (demote-then-set)", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const first = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "First", isPrimary: true }),
    });
    const second = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "Second", isPrimary: true }),
    });

    const primaries = await livePrimaries(agency.id, client.id);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(second!.id);

    const [firstRow] = await db.select().from(clientContacts).where(eq(clientContacts.id, first!.id));
    expect(firstRow?.isPrimary).toBe(false); // demoted
  });

  it("promoting via update demotes the incumbent", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const incumbent = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "Old", isPrimary: true }),
    });
    const challenger = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "New", isPrimary: false }),
    });

    await updateContact({ agencyId: agency.id, id: challenger!.id, input: { isPrimary: true } });

    const primaries = await livePrimaries(agency.id, client.id);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(challenger!.id);

    const [oldRow] = await db.select().from(clientContacts).where(eq(clientContacts.id, incumbent!.id));
    expect(oldRow?.isPrimary).toBe(false);
  });

  it("RACE: concurrent primary creates for one client yield exactly one primary", async () => {
    // The advisory lock (client-primary:<clientId>) serializes the
    // demote-then-set so every insert lands and the last committer wins the
    // primary flag. Without the lock these would race — and the partial
    // unique index is the hard backstop that turns any slip into a CONFLICT
    // rather than two primaries. Same shape as the membership one-owner race.
    const agency = await freshAgency();
    const client = await seedClient(agency.id);

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createContact({
          agencyId: agency.id,
          input: mkCreate(client.id, { firstName: `Racer${i}`, isPrimary: true }),
        })
      )
    );

    expect(await livePrimaries(agency.id, client.id)).toHaveLength(1);
    // All six rows were still created (demote flips a flag, it doesn't delete).
    const all = await listContactsByClient(agency.id, client.id);
    expect(all).toHaveLength(6);
  });

  it("INDEX BACKSTOP: the DB itself rejects a second live primary, service bypassed", async () => {
    // Proves the invariant is enforced by client_contacts_one_primary
    // independent of caller discipline — a raw insert that skips the service's
    // demote step is refused by Postgres (23505), which is exactly the safety
    // net that survives a future bulk import or forgotten lock.
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    await db
      .insert(clientContacts)
      .values({ agencyId: agency.id, clientId: client.id, firstName: "P1", isPrimary: true });

    await expect(
      db
        .insert(clientContacts)
        .values({ agencyId: agency.id, clientId: client.id, firstName: "P2", isPrimary: true })
    ).rejects.toMatchObject({ code: "23505" });

    // A second NON-primary is fine (partial index only constrains primaries).
    await expect(
      db
        .insert(clientContacts)
        .values({ agencyId: agency.id, clientId: client.id, firstName: "P3", isPrimary: false })
    ).resolves.toBeDefined();
  });

  it("soft-deleting the primary frees the slot for a new one", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const first = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "P1", isPrimary: true }),
    });
    await deleteContact({ agencyId: agency.id, id: first!.id });

    // Partial index excludes deleted rows, so this must succeed.
    const second = await createContact({
      agencyId: agency.id,
      input: mkCreate(client.id, { firstName: "P2", isPrimary: true }),
    });
    const primaries = await livePrimaries(agency.id, client.id);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(second!.id);
  });
});

describe("Zod boundary (schema, no DB)", () => {
  it("createContactSchema lowercases email and defaults isPrimary to false", () => {
    const parsed = createContactSchema.parse({
      clientId: "11111111-1111-1111-1111-111111111111",
      firstName: "Mixed",
      email: "Person@Example.COM",
    });
    expect(parsed.email).toBe("person@example.com");
    expect(parsed.isPrimary).toBe(false);
  });

  it("requires firstName, rejects a bad email", () => {
    expect(
      createContactSchema.safeParse({
        clientId: "11111111-1111-1111-1111-111111111111",
        firstName: "",
      }).success
    ).toBe(false);
    expect(
      createContactSchema.safeParse({
        clientId: "11111111-1111-1111-1111-111111111111",
        firstName: "Ok",
        email: "not-an-email",
      }).success
    ).toBe(false);
  });

  it("updateContactSchema bakes in NO default (isPrimary absent stays absent)", () => {
    // The updateClientSchema lesson: a field default surviving .partial()
    // would silently reset isPrimary on every unrelated patch.
    const parsed = updateContactSchema.parse({ firstName: "OnlyName" });
    expect("isPrimary" in parsed).toBe(false);
  });
});

describe("email lowercasing round-trip (service + DB)", () => {
  it("stores the Zod-lowercased email", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    const input = createContactSchema.parse({
      clientId: client.id,
      firstName: "Case",
      email: "Loud@Example.COM",
    });
    const created = await createContact({ agencyId: agency.id, input });
    expect(created?.email).toBe("loud@example.com");
  });

  it("DB CHECK backstops a raw mixed-case email that skips Zod", async () => {
    const agency = await freshAgency();
    const client = await seedClient(agency.id);
    await expect(
      db
        .insert(clientContacts)
        .values({ agencyId: agency.id, clientId: client.id, firstName: "Raw", email: "NO@X.COM" })
    ).rejects.toMatchObject({ code: "23514" }); // check_violation
  });
});
