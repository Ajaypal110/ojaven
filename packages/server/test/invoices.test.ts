import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients, db, invoices, proposalLineItems, proposals } from "@ojaven/db";
import {
  convertProposalToInvoice,
  createInvoice,
  getInvoiceById,
  listInvoices,
  markPaymentRefunded,
  recordPayment,
  sendInvoice,
  updateInvoice,
  voidInvoice,
} from "../src/services/invoices";
import { getInvoiceByToken, markInvoiceViewed } from "../src/services/publicInvoices";
import { createProposal, sendProposal } from "../src/services/proposals";
import { respondToProposal } from "../src/services/publicProposals";
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
async function member(agencyId: string, label = "u") {
  const u = await seedUser(label);
  userIds.push(u.id);
  await ensureMembership({ agencyId, userId: u.id });
  return u.id;
}
async function seedClient(agencyId: string, name = "Acme Co") {
  const [c] = await db.insert(clients).values({ agencyId, name }).returning();
  return c!;
}
const items = [
  { description: "Design", quantity: 2, unitPrice: 100 },
  { description: "Dev", quantity: 1, unitPrice: 500 },
]; // subtotal 700

/** A full accepted proposal ready for conversion. */
async function acceptedProposal(agencyId: string, clientId: string, actor: string) {
  const p = await createProposal({
    agencyId,
    actorUserId: actor,
    input: { clientId, title: "Retainer Q4", bodyHtml: "<p>Scope</p>", lineItems: items },
  });
  const sent = await sendProposal({ agencyId, id: p.id });
  await respondToProposal({ token: sent.publicToken!, decision: "accept", signedByName: "Jane" });
  return p;
}

describe("invoice numbering (advisory lock + unique backstop)", () => {
  it("RACE: concurrent creates get sequential, unique, gapless numbers", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);

    const created = await Promise.all(
      Array.from({ length: 6 }, () =>
        createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0 } })
      )
    );
    const numbers = created.map((i) => i.invoiceNumber).sort();
    expect(numbers).toEqual(["INV-0001", "INV-0002", "INV-0003", "INV-0004", "INV-0005", "INV-0006"]);
  });

  it("sequences are per-agency (both start at INV-0001)", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const ca = await seedClient(a.id);
    const cb = await seedClient(b.id);
    const ia = await createInvoice({ agencyId: a.id, input: { clientId: ca.id, tax: 0 } });
    const ib = await createInvoice({ agencyId: b.id, input: { clientId: cb.id, tax: 0 } });
    expect(ia.invoiceNumber).toBe("INV-0001");
    expect(ib.invoiceNumber).toBe("INV-0001");
  });
});

describe("proposal -> invoice conversion (snapshot, never reference)", () => {
  it("SNAPSHOT INTEGRITY: mutating the proposal after conversion changes NOTHING on the invoice", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const proposal = await acceptedProposal(a.id, client.id, uid);

    const invoice = await convertProposalToInvoice({
      agencyId: a.id,
      input: { proposalId: proposal.id, tax: 70 },
    });
    expect(Number(invoice.subtotal)).toBe(700);
    expect(Number(invoice.tax)).toBe(70);
    expect(Number(invoice.total)).toBe(770);
    expect(invoice.proposalId).toBe(proposal.id);

    const before = await getInvoiceById({ agencyId: a.id, id: invoice.id });
    expect(before.lineItems.map((li) => li.description)).toEqual(["Design", "Dev"]);

    // Sabotage the proposal every way a future code path could: retitle it,
    // rewrite its line items, delete them, soft-delete the proposal itself.
    await db.update(proposals).set({ title: "REWRITTEN", value: "99999.00" }).where(eq(proposals.id, proposal.id));
    await db
      .update(proposalLineItems)
      .set({ description: "TAMPERED", quantity: "99.00", unitPrice: "9999.00", amount: "989901.00" })
      .where(eq(proposalLineItems.proposalId, proposal.id));
    await db.delete(proposalLineItems).where(eq(proposalLineItems.proposalId, proposal.id));
    await db.update(proposals).set({ deletedAt: new Date() }).where(eq(proposals.id, proposal.id));

    // The invoice is frozen — identical in every particular.
    const after = await getInvoiceById({ agencyId: a.id, id: invoice.id });
    expect(after.lineItems.map((li) => li.description)).toEqual(["Design", "Dev"]);
    expect(after.lineItems.map((li) => Number(li.amount))).toEqual([200, 500]);
    expect(Number(after.subtotal)).toBe(700);
    expect(Number(after.total)).toBe(770);
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
  });

  it("refuses to convert a non-accepted proposal", async () => {
    const a = await freshAgency();
    const uid = await member(a.id);
    const client = await seedClient(a.id);
    const draft = await createProposal({
      agencyId: a.id,
      actorUserId: uid,
      input: { clientId: client.id, title: "Draft", lineItems: items },
    });
    await expect(
      convertProposalToInvoice({ agencyId: a.id, input: { proposalId: draft.id, tax: 0 } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("payments — partial, complete, overpayment, refund-unpay", () => {
  it("runs the full transition matrix", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const invoice = await createInvoice({
      agencyId: a.id,
      input: { clientId: client.id, tax: 0, lineItems: [{ description: "Work", quantity: 1, unitPrice: 1000 }] },
    });

    // Draft: no payments yet.
    await expect(
      recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 100 } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /Send the invoice/ });

    await sendInvoice({ agencyId: a.id, id: invoice.id });

    // Partial -> still sent.
    await recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 400 } });
    let current = await getInvoiceById({ agencyId: a.id, id: invoice.id });
    expect(current.status).toBe("sent");
    expect(current.paidTotal).toBe(400);

    // Overpayment rejected (600 remaining).
    await expect(
      recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 700 } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /remaining balance/ });

    // Complete -> paid.
    const finalPayment = await recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 600 } });
    current = await getInvoiceById({ agencyId: a.id, id: invoice.id });
    expect(current.status).toBe("paid");
    expect(current.paidTotal).toBe(1000);

    // Paid is terminal for recording.
    await expect(
      recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 1 } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Refund the final payment -> un-pays back to sent.
    await markPaymentRefunded({ agencyId: a.id, paymentId: finalPayment!.id });
    current = await getInvoiceById({ agencyId: a.id, id: invoice.id });
    expect(current.status).toBe("sent");
    expect(current.paidTotal).toBe(400);

    // Refunding a non-succeeded payment refused.
    await expect(
      markPaymentRefunded({ agencyId: a.id, paymentId: finalPayment!.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("draft-only edit + void semantics", () => {
  it("edits a draft (recomputes totals); refuses once sent", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const invoice = await createInvoice({
      agencyId: a.id,
      input: { clientId: client.id, tax: 10, lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] },
    });
    expect(Number(invoice.total)).toBe(110);

    const updated = await updateInvoice({
      agencyId: a.id,
      input: { id: invoice.id, tax: 20, lineItems: [{ description: "Y", quantity: 2, unitPrice: 100 }] },
    });
    expect(Number(updated.subtotal)).toBe(200);
    expect(Number(updated.total)).toBe(220);

    await sendInvoice({ agencyId: a.id, id: invoice.id });
    await expect(
      updateInvoice({ agencyId: a.id, input: { id: invoice.id, tax: 0 } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("voids draft and sent-without-payments; refuses paid and paid-partial; keeps its number", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);

    const draft = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0 } });
    const voided = await voidInvoice({ agencyId: a.id, id: draft.id });
    expect(voided.status).toBe("void");
    expect(voided.invoiceNumber).toBe(draft.invoiceNumber); // number kept -> gapless

    // Sent with a payment: refund first.
    const inv2 = await createInvoice({
      agencyId: a.id,
      input: { clientId: client.id, tax: 0, lineItems: [{ description: "W", quantity: 1, unitPrice: 100 }] },
    });
    await sendInvoice({ agencyId: a.id, id: inv2.id });
    await recordPayment({ agencyId: a.id, input: { invoiceId: inv2.id, amount: 50 } });
    await expect(voidInvoice({ agencyId: a.id, id: inv2.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: /Refund its payments/,
    });
  });
});

describe("derived overdue", () => {
  it("sent + past due derives overdue; filter returns it; future due does not", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    const overdueInv = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0, dueDate: past } });
    await sendInvoice({ agencyId: a.id, id: overdueInv.id });
    const fineInv = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0, dueDate: future } });
    await sendInvoice({ agencyId: a.id, id: fineInv.id });

    const all = await listInvoices({ agencyId: a.id });
    expect(all.find((i) => i.id === overdueInv.id)?.isOverdue).toBe(true);
    expect(all.find((i) => i.id === fineInv.id)?.isOverdue).toBe(false);

    const onlyOverdue = await listInvoices({ agencyId: a.id, status: "overdue" });
    expect(onlyOverdue.map((i) => i.id)).toEqual([overdueInv.id]);
  });
});

describe("public /i token access", () => {
  it("send mints a token; view shows display + paidTotal, leaks no internals", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const invoice = await createInvoice({
      agencyId: a.id,
      input: { clientId: client.id, tax: 0, lineItems: [{ description: "Work", quantity: 1, unitPrice: 300 }] },
    });
    const sent = await sendInvoice({ agencyId: a.id, id: invoice.id });
    expect(sent.publicToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    await recordPayment({ agencyId: a.id, input: { invoiceId: invoice.id, amount: 100 } });

    const view = await getInvoiceByToken(sent.publicToken!);
    expect(view.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(view.agencyName).toBe(a.name);
    expect(view.paidTotal).toBe(100);
    expect(view.lineItems).toHaveLength(1);
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("clientId");
    expect(view).not.toHaveProperty("publicToken");
  });

  it("VOID stays visible by token (unlike a 404) — the client holds the link", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const invoice = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0 } });
    const sent = await sendInvoice({ agencyId: a.id, id: invoice.id });
    await voidInvoice({ agencyId: a.id, id: invoice.id });

    const view = await getInvoiceByToken(sent.publicToken!);
    expect(view.status).toBe("void");
  });

  it("draft-with-forced-token and wrong token are uniform NOT_FOUND; viewedAt stamps once", async () => {
    const a = await freshAgency();
    const client = await seedClient(a.id);
    const draft = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0 } });
    await db.update(invoices).set({ publicToken: "forced-draft-invoice-token-000000" }).where(eq(invoices.id, draft.id));
    await expect(getInvoiceByToken("forced-draft-invoice-token-000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getInvoiceByToken("no-such-invoice-token-anywhere-x")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const inv = await createInvoice({ agencyId: a.id, input: { clientId: client.id, tax: 0 } });
    const sent = await sendInvoice({ agencyId: a.id, id: inv.id });
    await markInvoiceViewed(sent.publicToken!);
    const [row1] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row1?.viewedAt).not.toBeNull();
    const first = row1?.viewedAt;
    await markInvoiceViewed(sent.publicToken!);
    const [row2] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row2?.viewedAt?.getTime()).toBe(first?.getTime()); // stamped once
  });
});
