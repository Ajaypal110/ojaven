import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { agencies, db, teamMembers, users } from "@ojaven/db";
import {
  handleUserDeleted,
  provisionUserRow,
  tombstoneEmail,
} from "../src/services/userProvisioning";
import { softDeleteAgencyByClerkOrgId } from "../src/services/agencyLifecycle";
import { stubGateway } from "./helpers";

const userIds: string[] = [];
const agencyIds: string[] = [];

afterAll(async () => {
  if (agencyIds.length) await db.delete(agencies).where(inArray(agencies.id, agencyIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
});

function ids() {
  const oldId = `user_provOLD_${randomUUID().replace(/-/g, "")}`;
  const newId = `user_provNEW_${randomUUID().replace(/-/g, "")}`;
  userIds.push(oldId, newId);
  return { oldId, newId, email: `prov-${randomUUID()}@test.ojaven.local` };
}

async function row(id: string) {
  const [r] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return r;
}

describe("provisionUserRow — virgin + idempotent", () => {
  it("inserts a fresh row for an unused email", async () => {
    const { newId, email } = ids();
    const { gateway } = stubGateway();
    await provisionUserRow({
      gateway,
      identity: { id: newId, email, firstName: "New", lastName: null, imageUrl: null },
    });
    const r = await row(newId);
    expect(r?.email).toBe(email);
    expect(r?.deletedAt).toBeNull();
  });

  it("is idempotent by id — second call refreshes fields, one row, un-tombstones", async () => {
    const { newId, email } = ids();
    const { gateway } = stubGateway();
    await provisionUserRow({
      gateway,
      identity: { id: newId, email, firstName: "First", lastName: null, imageUrl: null },
    });
    await provisionUserRow({
      gateway,
      identity: { id: newId, email, firstName: "Updated", lastName: "Name", imageUrl: null },
    });
    const all = await db.select().from(users).where(eq(users.id, newId));
    expect(all).toHaveLength(1);
    expect(all[0]?.firstName).toBe("Updated");
  });
});

describe("provisionUserRow — recycled email reclaim", () => {
  it("tombstones a dead-in-Clerk orphan and creates the new row, leaving old team_members untouched", async () => {
    const { oldId, newId, email } = ids();

    // Seed the orphan user + an agency + a team_members row keyed to it.
    await db.insert(users).values({ id: oldId, email });
    const [agency] = await db
      .insert(agencies)
      .values({ clerkOrgId: `org_test_${randomUUID()}`, name: "Reclaim Co" })
      .returning();
    agencyIds.push(agency!.id);
    const [oldMembership] = await db
      .insert(teamMembers)
      .values({ agencyId: agency!.id, userId: oldId, role: "owner" })
      .returning();

    // Old id is NOT among the live owners of this email -> reclaimable.
    const { gateway } = stubGateway({}, { [email]: [] });
    await provisionUserRow({
      gateway,
      identity: { id: newId, email, firstName: null, lastName: null, imageUrl: null },
    });

    const orphan = await row(oldId);
    const reclaimed = await row(newId);
    expect(orphan?.email).toBe(tombstoneEmail(oldId));
    expect(orphan?.deletedAt).not.toBeNull();
    expect(reclaimed?.email).toBe(email);
    expect(reclaimed?.deletedAt).toBeNull();

    // History stays keyed to the dead id — the membership row is untouched.
    const [membershipAfter] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, oldMembership!.id));
    expect(membershipAfter?.userId).toBe(oldId);
    expect(membershipAfter?.deletedAt).toBeNull();
  });

  it("refuses with a readable CONFLICT when the email is still owned by a live account", async () => {
    const { oldId, newId, email } = ids();
    await db.insert(users).values({ id: oldId, email });

    // Old id IS live in Clerk -> genuine conflict, not an orphan.
    const { gateway } = stubGateway({}, { [email]: [oldId] });

    await expect(
      provisionUserRow({
        gateway,
        identity: { id: newId, email, firstName: null, lastName: null, imageUrl: null },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This email is already associated with an active account.",
    });

    // Zero mutations: old row intact, no new row.
    expect((await row(oldId))?.email).toBe(email);
    expect(await row(newId)).toBeUndefined();
  });

  it("CONCURRENCY: double-fire for the same new identity yields one row, orphan tombstoned once", async () => {
    const { oldId, newId, email } = ids();
    await db.insert(users).values({ id: oldId, email });
    const { gateway } = stubGateway({}, { [email]: [] });

    const identity = { id: newId, email, firstName: null, lastName: null, imageUrl: null };
    // Both fire concurrently — the per-email advisory lock serializes them.
    await Promise.all([
      provisionUserRow({ gateway, identity }),
      provisionUserRow({ gateway, identity }),
    ]);

    const news = await db.select().from(users).where(eq(users.id, newId));
    expect(news).toHaveLength(1);
    expect(news[0]?.email).toBe(email);
    expect((await row(oldId))?.email).toBe(tombstoneEmail(oldId));
  });
});

describe("handleUserDeleted — tombstone frees the email, idempotent", () => {
  it("tombstones on delete, and a re-signup with the same email then inserts cleanly", async () => {
    const { oldId, newId, email } = ids();
    await db.insert(users).values({ id: oldId, email });

    await handleUserDeleted(oldId);
    const dead = await row(oldId);
    expect(dead?.email).toBe(tombstoneEmail(oldId));
    expect(dead?.deletedAt).not.toBeNull();

    // Tombstone-already-tombstoned is a NO-OP, not a crash (nail-down #1).
    await expect(handleUserDeleted(oldId)).resolves.toBeUndefined();
    await Promise.all([handleUserDeleted(oldId), handleUserDeleted(oldId)]); // concurrent, still fine

    // Email slot is free — new id inserts with no reclaim needed.
    const { gateway } = stubGateway();
    await provisionUserRow({
      gateway,
      identity: { id: newId, email, firstName: null, lastName: null, imageUrl: null },
    });
    expect((await row(newId))?.email).toBe(email);
  });
});

describe("softDeleteAgencyByClerkOrgId", () => {
  it("soft-deletes by clerk org id, idempotent on a second call", async () => {
    const clerkOrgId = `org_test_${randomUUID()}`;
    const [agency] = await db
      .insert(agencies)
      .values({ clerkOrgId, name: "Org Deleted Co" })
      .returning();
    agencyIds.push(agency!.id);

    const first = await softDeleteAgencyByClerkOrgId(clerkOrgId);
    expect(first?.id).toBe(agency!.id);
    const [after] = await db.select().from(agencies).where(eq(agencies.id, agency!.id));
    expect(after?.deletedAt).not.toBeNull();

    // Already deleted -> matches nothing -> null, no throw.
    expect(await softDeleteAgencyByClerkOrgId(clerkOrgId)).toBeNull();
  });
});
