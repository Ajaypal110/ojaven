import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { clientContacts, clients, db } from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type { CreateContactInput, UpdateContactInput } from "@ojaven/shared";
import { lockKey } from "./agencyLock";

/**
 * A contact is only reachable through a LIVE client (exists, same agency, not
 * soft-deleted). Soft-deleting a client doesn't cascade to its contacts — the
 * FK cascade is for hard delete only — so a churned client's contacts still
 * sit there with deletedAt IS NULL. This guard is what keeps them unreachable.
 * Throws the same opaque NOT_FOUND as client.byId: "wrong agency", "deleted",
 * and "never existed" are indistinguishable in the response.
 */
async function assertClientLive(dbc: typeof db | Tx, agencyId: string, clientId: string) {
  const [client] = await dbc
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.agencyId, agencyId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found." });
}

/**
 * Load a contact by id, requiring BOTH the contact and its parent client to be
 * live (agency-scoped). The join is what enforces "reachable only through a
 * live client" for the by-id operations (update/delete), which don't take a
 * clientId in their input. Returns the contact row (clientId included, needed
 * for the primary lock) or throws NOT_FOUND.
 */
async function loadLiveContact(dbc: typeof db | Tx, agencyId: string, id: string) {
  const [row] = await dbc
    .select({ contact: clientContacts })
    .from(clientContacts)
    .innerJoin(clients, eq(clients.id, clientContacts.clientId))
    .where(
      and(
        eq(clientContacts.id, id),
        eq(clientContacts.agencyId, agencyId),
        isNull(clientContacts.deletedAt),
        isNull(clients.deletedAt)
      )
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found." });
  return row.contact;
}

/** Clear any live primary contact(s) for a client — the "demote" half of demote-then-set. */
async function demotePrimaries(tx: Tx, agencyId: string, clientId: string) {
  await tx
    .update(clientContacts)
    .set({ isPrimary: false })
    .where(
      and(
        eq(clientContacts.agencyId, agencyId),
        eq(clientContacts.clientId, clientId),
        eq(clientContacts.isPrimary, true),
        isNull(clientContacts.deletedAt)
      )
    );
}

function isOnePrimaryViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505" &&
      // Only the one-primary index maps to CONFLICT; any other unique
      // violation on this table (there are none today) should surface as-is.
      String((err as { constraint?: string }).constraint ?? "").includes("client_contacts_one_primary")
  );
}

/**
 * Wrap the demote-then-set critical section so the partial unique index's
 * backstop 23505 (should the advisory lock ever be bypassed or lost to a race)
 * surfaces as a readable CONFLICT rather than a raw Postgres error — the same
 * lock+constraint+readable-error shape changeSubdomain uses.
 */
async function withPrimaryConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isOnePrimaryViolation(err)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "That client already has a primary contact. Try again.",
      });
    }
    throw err;
  }
}

function insertValues(agencyId: string, clientId: string, input: CreateContactInput) {
  // Empty string (explicitly sent) means "clear it" -> null, same presence
  // convention as clients. firstName is required (NOT NULL).
  return {
    agencyId,
    clientId,
    firstName: input.firstName,
    lastName: input.lastName || null,
    email: input.email || null,
    phone: input.phone || null,
    title: input.title || null,
    isPrimary: input.isPrimary === true,
  } satisfies typeof clientContacts.$inferInsert;
}

/** Contacts for one client, primary first then newest — parent must be live. */
export async function listContactsByClient(agencyId: string, clientId: string) {
  await assertClientLive(db, agencyId, clientId);
  return db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.agencyId, agencyId),
        eq(clientContacts.clientId, clientId),
        isNull(clientContacts.deletedAt)
      )
    )
    .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt));
}

/**
 * Create a contact. When isPrimary is requested, the demote-then-insert runs
 * under a per-client advisory lock (so concurrent "make me primary" requests
 * serialize instead of both inserting a primary), with the partial unique
 * index as the hard backstop. The non-primary path is a plain insert — adding
 * a non-primary can't break the at-most-one invariant.
 */
export async function createContact(params: {
  agencyId: string;
  input: CreateContactInput;
}) {
  const { agencyId, input } = params;
  const values = insertValues(agencyId, input.clientId, input);

  if (input.isPrimary !== true) {
    await assertClientLive(db, agencyId, input.clientId);
    const [row] = await db.insert(clientContacts).values(values).returning();
    return row;
  }

  return withPrimaryConflict(() =>
    txDb.transaction(async (tx) => {
      await lockKey(tx, "client-primary", input.clientId);
      await assertClientLive(tx, agencyId, input.clientId);
      await demotePrimaries(tx, agencyId, input.clientId);
      const [row] = await tx.insert(clientContacts).values(values).returning();
      return row;
    })
  );
}

/**
 * Update a contact. Presence-based: undefined = not sent (untouched), empty
 * string = clear to null. Rejects an empty patch. Promoting to primary
 * (isPrimary:true) takes the per-client lock and demotes the incumbent first;
 * everything else — including demoting via isPrimary:false — is a plain write.
 * clientId is immutable (not in the schema), so the lock key is stable.
 */
export async function updateContact(params: {
  agencyId: string;
  id: string;
  input: UpdateContactInput;
}) {
  const { agencyId, id, input } = params;

  const set: Partial<typeof clientContacts.$inferInsert> = {};
  if (input.firstName !== undefined) set.firstName = input.firstName;
  if (input.lastName !== undefined) set.lastName = input.lastName || null;
  if (input.email !== undefined) set.email = input.email || null;
  if (input.phone !== undefined) set.phone = input.phone || null;
  if (input.title !== undefined) set.title = input.title || null;
  if (input.isPrimary !== undefined) set.isPrimary = input.isPrimary;

  if (Object.keys(set).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const promoting = input.isPrimary === true;

  return withPrimaryConflict(() =>
    txDb.transaction(async (tx) => {
      // Guard read (contact + parent client both live). clientId is immutable,
      // so reading it before taking the lock is safe.
      const contact = await loadLiveContact(tx, agencyId, id);

      if (promoting) {
        await lockKey(tx, "client-primary", contact.clientId);
        await demotePrimaries(tx, agencyId, contact.clientId);
      }

      const [updated] = await tx
        .update(clientContacts)
        .set(set)
        .where(
          and(
            eq(clientContacts.id, id),
            eq(clientContacts.agencyId, agencyId),
            isNull(clientContacts.deletedAt)
          )
        )
        .returning();
      return updated;
    })
  );
}

/** Soft delete — parent must be live. No lock: removing a primary can't create a second one. */
export async function deleteContact(params: { agencyId: string; id: string }) {
  const { agencyId, id } = params;
  await loadLiveContact(db, agencyId, id);
  const [row] = await db
    .update(clientContacts)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(clientContacts.id, id),
        eq(clientContacts.agencyId, agencyId),
        isNull(clientContacts.deletedAt)
      )
    )
    .returning({ id: clientContacts.id });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found." });
  return row;
}
