import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients, db, retainers, tasks, timeEntries } from "@ojaven/db";
import { logTimeEntrySchema, setRetainerSchema } from "@ojaven/shared";
import {
  currentMonthInTimezone,
  todayInTimezone,
} from "../src/services/agencyClock";
import {
  getCurrentRetainer,
  listRetainers,
  setRetainer,
} from "../src/services/retainers";
import {
  deleteEntry,
  listByClient,
  logEntry,
  monthlyRollup,
  updateEntry,
} from "../src/services/time";
import { ensureMembership } from "../src/services/teamMembership";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];
afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

async function freshAgency() {
  const a = await seedAgency();
  agencyIds.push(a.id);
  return a;
}
async function seedMember(agencyId: string, label: string, clerkOrgRole?: string) {
  const u = await seedUser(label);
  userIds.push(u.id);
  const r = await ensureMembership({ agencyId, userId: u.id, clerkOrgRole });
  return { userId: u.id, role: r.member!.role };
}
async function seedClient(agencyId: string, name = "Acme Co") {
  const [c] = await db.insert(clients).values({ agencyId, name }).returning();
  return c!;
}

// ── Timezone clock (pure, deterministic via injected `now`) ──────────────────
describe("agencyClock — timezone-aware today", () => {
  it("computes today per zone, not server UTC", () => {
    const noon = new Date("2026-07-21T12:00:00Z");
    expect(todayInTimezone("UTC", noon)).toBe("2026-07-21");
    expect(todayInTimezone("Pacific/Auckland", noon)).toBe("2026-07-22"); // UTC+12 → next day
    expect(todayInTimezone("Pacific/Midway", noon)).toBe("2026-07-21"); // UTC-11 → same day
    expect(todayInTimezone("Not/AZone", noon)).toBe("2026-07-21"); // invalid → UTC fallback
  });
  it("current month rolls with the zone at a month boundary", () => {
    const eve = new Date("2026-06-30T12:00:00Z");
    expect(currentMonthInTimezone("UTC", eve)).toBe("2026-06");
    expect(currentMonthInTimezone("Pacific/Auckland", eve)).toBe("2026-07"); // already July there
  });
});

// ── THE test: effective-dated retainer → different months, different truth ───
describe("effective-dated retainers (why Option B)", () => {
  it("a mid-engagement retainer change makes Feb and March compute differently", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);

    await setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 20, effectiveFrom: "2026-01-01" } });
    await setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 30, effectiveFrom: "2026-03-01" } });

    // History: two periods; the Jan period closed the day before March.
    const hist = await listRetainers(a.id, client.id);
    expect(hist).toHaveLength(2);
    const janPeriod = hist.find((r) => r.effectiveFrom === "2026-01-01")!;
    expect(janPeriod.effectiveTo).toBe("2026-02-28"); // day before 2026-03-01
    const current = await getCurrentRetainer(a.id, client.id);
    expect(Number(current!.hoursPerMonth)).toBe(30);
    expect(current!.effectiveTo).toBeNull();

    // Same 25 billable hours logged in each month.
    for (const month of ["2026-02", "2026-03"]) {
      await logEntry({ agencyId: a.id, userId: (await seedMember(a.id, `u-${month}`)).userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 20, entryDate: `${month}-10` }) });
      await logEntry({ agencyId: a.id, userId: (await seedMember(a.id, `v-${month}`)).userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 5, entryDate: `${month}-11` }) });
    }

    const feb = await monthlyRollup({ agencyId: a.id, clientId: client.id, month: "2026-02" });
    expect(feb.retainerHours).toBe(20);
    expect(feb.billableHours).toBe(25);
    expect(feb.overServiceHours).toBe(5);
    expect(feb.overServicePct).toBe(125);
    expect(feb.isOverService).toBe(true);

    const mar = await monthlyRollup({ agencyId: a.id, clientId: client.id, month: "2026-03" });
    expect(mar.retainerHours).toBe(30); // the SAME 25h is NOT over-service here
    expect(mar.billableHours).toBe(25);
    expect(mar.overServiceHours).toBe(0);
    expect(mar.overServicePct).toBe(83.33);
    expect(mar.isOverService).toBe(false);
  });

  it("refuses a new period at or before the current one; index backstops a raw double-open", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    await setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 10, effectiveFrom: "2026-05-01" } });

    await expect(
      setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 15, effectiveFrom: "2026-05-01" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Raw double-open bypassing the service -> partial unique index rejects.
    const other = await seedClient(a.id);
    await db.insert(retainers).values({ agencyId: a.id, clientId: other.id, hoursPerMonth: "10", effectiveFrom: "2026-01-01" });
    await expect(
      db.insert(retainers).values({ agencyId: a.id, clientId: other.id, hoursPerMonth: "20", effectiveFrom: "2026-02-01" })
    ).rejects.toMatchObject({ code: "23505" });
  });
});

// ── Rollup math + over-service derivation ────────────────────────────────────
describe("monthlyRollup / listByClient over-service (derived, billable-only)", () => {
  it("only billable hours consume the retainer", async () => {
    const a = await freshAgency();
    const me = await seedMember(a.id, "logger");
    const client = await seedClient(a.id);
    await setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 12, effectiveFrom: "2026-04-01" } });

    await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 10, entryDate: "2026-04-05" }) });
    await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 5, entryDate: "2026-04-06", isBillable: false }) });

    let roll = await monthlyRollup({ agencyId: a.id, clientId: client.id, month: "2026-04" });
    expect(roll.billableHours).toBe(10);
    expect(roll.nonBillableHours).toBe(5);
    expect(roll.totalHours).toBe(15);
    expect(roll.isOverService).toBe(false); // 10 billable <= 12, despite 15 total

    await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 5, entryDate: "2026-04-07" }) });
    roll = await monthlyRollup({ agencyId: a.id, clientId: client.id, month: "2026-04" });
    expect(roll.billableHours).toBe(15);
    expect(roll.overServiceHours).toBe(3); // 15 - 12
    expect(roll.isOverService).toBe(true);
  });

  it("marks per-entry over-service by running cumulative, newest-first", async () => {
    const a = await freshAgency();
    const me = await seedMember(a.id, "logger");
    const client = await seedClient(a.id);
    await setRetainer({ agencyId: a.id, input: { clientId: client.id, hoursPerMonth: 10, effectiveFrom: "2026-06-01" } });

    const e1 = await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 6, entryDate: "2026-06-05" }) });
    const e2 = await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 6, entryDate: "2026-06-06" }) });
    const e3 = await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 4, entryDate: "2026-06-07", isBillable: false }) });

    const res = await listByClient({ agencyId: a.id, clientId: client.id, month: "2026-06" });
    expect(res.retainerHours).toBe(10);
    expect(res.entries.map((e) => e.id)).toEqual([e3!.id, e2!.id, e1!.id]); // newest-first
    const flag = (id: string) => res.entries.find((e) => e.id === id)!.isOverService;
    expect(flag(e1!.id)).toBe(false); // cumulative 6 <= 10
    expect(flag(e2!.id)).toBe(true); //  cumulative 12 > 10
    expect(flag(e3!.id)).toBe(false); // non-billable never over
  });

  it("no retainer -> null retainer, never over-service", async () => {
    const a = await freshAgency();
    const me = await seedMember(a.id, "logger");
    const client = await seedClient(a.id);
    await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 8, entryDate: "2026-04-10" }) });
    const roll = await monthlyRollup({ agencyId: a.id, clientId: client.id, month: "2026-04" });
    expect(roll.retainerHours).toBeNull();
    expect(roll.overServicePct).toBeNull();
    expect(roll.isOverService).toBe(false);
    expect(roll.billableHours).toBe(8);
  });
});

// ── Guards + correction matrix + validation ─────────────────────────────────
describe("logEntry guards + validation", () => {
  it("rejects soft-deleted client, cross-agency client, foreign task, and future dates", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const me = await seedMember(a.id, "logger");

    const dead = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, dead.id));
    await expect(
      logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: dead.id, hours: 1, entryDate: "2026-04-01" }) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const bClient = await seedClient(b.id);
    await expect(
      logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: bClient.id, hours: 1, entryDate: "2026-04-01" }) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Task from another agency.
    const client = await seedClient(a.id);
    const [bTask] = await db.insert(tasks).values({ agencyId: b.id, title: "b task" }).returning();
    await expect(
      logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 1, entryDate: "2026-04-01", taskId: bTask!.id }) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Far-future date (unambiguous regardless of tz).
    await expect(
      logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 1, entryDate: "2099-01-01" }) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /future/ });
  });

  it("Zod bounds hours and date format", () => {
    const base = { clientId: "11111111-1111-1111-1111-111111111111", entryDate: "2026-04-01" };
    expect(logTimeEntrySchema.safeParse({ ...base, hours: 0 }).success).toBe(false);
    expect(logTimeEntrySchema.safeParse({ ...base, hours: 25 }).success).toBe(false);
    expect(logTimeEntrySchema.safeParse({ ...base, hours: 8 }).success).toBe(true);
    expect(logTimeEntrySchema.safeParse({ clientId: base.clientId, hours: 8, entryDate: "2026-4-1" }).success).toBe(false);
    expect(setRetainerSchema.safeParse({ clientId: base.clientId, hoursPerMonth: 20, effectiveFrom: "2026-03-15" }).success).toBe(false); // not 1st
  });
});

describe("edit/delete correction matrix (own-or-owner/admin) + soft delete", () => {
  it("self and owner/admin can modify; a peer operator cannot", async () => {
    const a = await freshAgency();
    const owner = await seedMember(a.id, "owner"); // first -> owner
    const op1 = await seedMember(a.id, "op1"); // operator
    const op2 = await seedMember(a.id, "op2"); // operator
    const client = await seedClient(a.id);

    const entry = await logEntry({ agencyId: a.id, userId: op1.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 2, entryDate: "2026-04-01" }) });

    // Peer operator: forbidden.
    await expect(
      updateEntry({ agencyId: a.id, actor: op2, input: { id: entry!.id, hours: 3 } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Self: ok.
    const self = await updateEntry({ agencyId: a.id, actor: op1, input: { id: entry!.id, hours: 3 } });
    expect(Number(self.hours)).toBe(3);

    // Owner over someone else's: ok.
    const byOwner = await updateEntry({ agencyId: a.id, actor: owner, input: { id: entry!.id, description: "reviewed" } });
    expect(byOwner.description).toBe("reviewed");

    // Delete is soft, and gated the same way.
    await expect(
      deleteEntry({ agencyId: a.id, actor: op2, id: entry!.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteEntry({ agencyId: a.id, actor: owner, id: entry!.id });

    const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, entry!.id));
    expect(row?.deletedAt).not.toBeNull();

    // Excluded from reads.
    const res = await listByClient({ agencyId: a.id, clientId: client.id, month: "2026-04" });
    expect(res.entries).toHaveLength(0);
  });
});

describe("month default uses the agency timezone", () => {
  it("listByClient without a month returns the current month's entries", async () => {
    const a = await freshAgency();
    const me = await seedMember(a.id, "logger");
    const client = await seedClient(a.id);
    const today = todayInTimezone("UTC"); // agency has no settings row -> UTC
    await logEntry({ agencyId: a.id, userId: me.userId, input: logTimeEntrySchema.parse({ clientId: client.id, hours: 1, entryDate: today }) });

    const res = await listByClient({ agencyId: a.id, clientId: client.id }); // no month
    expect(res.month).toBe(today.slice(0, 7));
    expect(res.entries).toHaveLength(1);
  });
});
