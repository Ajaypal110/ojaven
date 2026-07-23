import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { clientContacts, clients, contentItems, db, deals } from "@ojaven/db";
import type { Tx } from "@ojaven/db/transactionClient";
import type { EntityType } from "@ojaven/shared";

type Dbc = typeof db | Tx;

// Built, agency-scoped, live-aware entities that polymorphic features (tags,
// custom fields, task links, activity timeline) can point at. content_item
// joined at A8 — which lit up all of those on content for free. The remaining
// enum members (task, proposal, invoice) stay unsupported until deliberately
// added.
const SUPPORTED = new Set<EntityType>(["client", "client_contact", "deal", "content_item"]);

const notAvailable = (entityType: EntityType) =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: `Tags and custom fields aren't available for ${entityType.replace(/_/g, " ")} yet.`,
  });

/** Gate for the DEFINITION side (custom fields are defined per entityType). */
export function assertSupportedEntityType(entityType: EntityType) {
  if (!SUPPORTED.has(entityType)) throw notAvailable(entityType);
}

/**
 * THE sole tenant-isolation + liveness enforcement for the polymorphic
 * tag/custom-field value writes. entityId has NO foreign key — it points at
 * different tables per entityType — so nothing at the DB level stops a
 * cross-agency or soft-deleted-entity reference. This function IS the backstop
 * (the polymorphic equivalent of the module-1 tenant-isolation risk, with no
 * FK to catch it).
 *
 * entityType is only a routing hint; the ownership + liveness check runs
 * against the actual owning table, so passing "client" with a deal's uuid
 * simply misses the client lookup -> NOT_FOUND. Each branch reuses that
 * module's exact liveness rule:
 *   - client:         agency-scoped, not soft-deleted
 *   - client_contact: + parent client not soft-deleted (A2 reachability)
 *   - deal:           + parent client not soft-deleted (deals' zero-mutation
 *                     client-soft-delete visibility rule)
 */
export async function assertEntityLive(
  dbc: Dbc,
  agencyId: string,
  entityType: EntityType,
  entityId: string
) {
  assertSupportedEntityType(entityType);

  let row: { id: string } | undefined;

  if (entityType === "client") {
    [row] = await dbc
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(eq(clients.id, entityId), eq(clients.agencyId, agencyId), isNull(clients.deletedAt))
      )
      .limit(1);
  } else if (entityType === "client_contact") {
    [row] = await dbc
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .innerJoin(clients, eq(clients.id, clientContacts.clientId))
      .where(
        and(
          eq(clientContacts.id, entityId),
          eq(clientContacts.agencyId, agencyId),
          isNull(clientContacts.deletedAt),
          isNull(clients.deletedAt)
        )
      )
      .limit(1);
  } else if (entityType === "deal") {
    [row] = await dbc
      .select({ id: deals.id })
      .from(deals)
      .innerJoin(clients, eq(clients.id, deals.clientId))
      .where(
        and(
          eq(deals.id, entityId),
          eq(deals.agencyId, agencyId),
          isNull(deals.deletedAt),
          isNull(clients.deletedAt)
        )
      )
      .limit(1);
  } else {
    // content_item — same shape: live item, live parent client
    [row] = await dbc
      .select({ id: contentItems.id })
      .from(contentItems)
      .innerJoin(clients, eq(clients.id, contentItems.clientId))
      .where(
        and(
          eq(contentItems.id, entityId),
          eq(contentItems.agencyId, agencyId),
          isNull(contentItems.deletedAt),
          isNull(clients.deletedAt)
        )
      )
      .limit(1);
  }

  if (!row) {
    // Opaque, like clients.byId: cross-agency, soft-deleted, and never-existed
    // are indistinguishable in the response.
    throw new TRPCError({ code: "NOT_FOUND", message: "That record no longer exists." });
  }
}
