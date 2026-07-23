import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  invoiceLineItems,
  invoices,
  payments,
  proposalLineItems,
  proposals,
} from "@ojaven/db";
import { txDb, type Tx } from "@ojaven/db/transactionClient";
import type {
  ConvertProposalInput,
  CreateInvoiceInput,
  InvoiceStatus,
  ProposalLineItemInput,
  RecordPaymentInput,
  UpdateInvoiceInput,
} from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";
import { lockKey } from "./agencyLock";

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);

const INVOICE_PREFIX = "INV-";
const formatInvoiceNumber = (seq: number) => `${INVOICE_PREFIX}${String(seq).padStart(4, "0")}`;

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505"
  );
}

/**
 * Next sequence for an agency: parse the numeric tail of the current max.
 * Safe because every number is generated HERE in the fixed INV-%04d format.
 * Callers hold the per-agency advisory lock; UNIQUE(agencyId, invoiceNumber)
 * is the backstop. No delete path + voids keep numbers = gapless by
 * construction.
 */
async function nextSequence(tx: Tx, agencyId: string): Promise<number> {
  const [row] = await tx
    .select({
      maxSeq: sql<number>`COALESCE(MAX(SUBSTRING(${invoices.invoiceNumber} FROM 5)::int), 0)`,
    })
    .from(invoices)
    .where(eq(invoices.agencyId, agencyId));
  return Number(row?.maxSeq ?? 0) + 1;
}

const sumItems = (items: ProposalLineItemInput[]) =>
  round2(items.reduce((s, li) => s + li.quantity * li.unitPrice, 0));

function itemRows(agencyId: string, invoiceId: string, items: ProposalLineItemInput[]) {
  return items.map((li, i) => ({
    agencyId,
    invoiceId,
    description: li.description,
    quantity: money(li.quantity),
    unitPrice: money(li.unitPrice),
    amount: money(li.quantity * li.unitPrice),
    sortOrder: i,
  }));
}

/** Shared numbered-create used by manual create and proposal conversion. */
async function createNumberedInvoice(params: {
  agencyId: string;
  clientId: string;
  proposalId: string | null;
  dueDate: Date | null;
  tax: number;
  items: ProposalLineItemInput[];
}) {
  const { agencyId } = params;
  const subtotal = sumItems(params.items);
  const total = round2(subtotal + params.tax);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await txDb.transaction(async (tx) => {
        await lockKey(tx, "invoice-number", agencyId);
        const seq = await nextSequence(tx, agencyId);
        const [invoice] = await tx
          .insert(invoices)
          .values({
            agencyId,
            clientId: params.clientId,
            proposalId: params.proposalId,
            invoiceNumber: formatInvoiceNumber(seq),
            subtotal: money(subtotal),
            tax: money(params.tax),
            total: money(total),
            dueDate: params.dueDate,
          })
          .returning();
        const rows = itemRows(agencyId, invoice!.id, params.items);
        if (rows.length) await tx.insert(invoiceLineItems).values(rows);
        return invoice!;
      });
    } catch (err) {
      // Backstop: a collision that slipped past the lock retries with a fresh max.
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not assign an invoice number." });
}

export async function createInvoice(params: { agencyId: string; input: CreateInvoiceInput }) {
  const { agencyId, input } = params;
  await assertEntityLive(db, agencyId, "client", input.clientId);
  return createNumberedInvoice({
    agencyId,
    clientId: input.clientId,
    proposalId: null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    tax: input.tax,
    items: input.lineItems ?? [],
  });
}

/**
 * The A6 structured-line-items payoff: SNAPSHOT-COPY an accepted proposal's
 * items into a new invoice. Copy, never reference — the invoice is frozen and
 * immune to anything that later happens to the proposal or its items.
 */
export async function convertProposalToInvoice(params: {
  agencyId: string;
  input: ConvertProposalInput;
}) {
  const { agencyId, input } = params;

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.id, input.proposalId),
        eq(proposals.agencyId, agencyId),
        isNull(proposals.deletedAt)
      )
    )
    .limit(1);
  if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found." });
  if (proposal.status !== "accepted") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Only accepted proposals can be converted to invoices.",
    });
  }
  await assertEntityLive(db, agencyId, "client", proposal.clientId);

  const items = await db
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.sortOrder));

  return createNumberedInvoice({
    agencyId,
    clientId: proposal.clientId,
    proposalId: proposal.id,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    tax: input.tax,
    items: items.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
    })),
  });
}

async function loadInvoice(dbc: typeof db | Tx, agencyId: string, id: string) {
  const [row] = await dbc
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.agencyId, agencyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
  return row;
}

const isOverdue = (inv: { status: string; dueDate: Date | null }) =>
  inv.status === "sent" && inv.dueDate != null && inv.dueDate.getTime() < Date.now();

/** Sum of succeeded payments for an invoice (0 when none). */
async function paidSum(dbc: typeof db | Tx, invoiceId: string): Promise<number> {
  const [row] = await dbc
    .select({
      paid: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${payments.status} = 'succeeded'), 0)`,
    })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  return Number(row?.paid ?? 0);
}

export async function listInvoices(params: {
  agencyId: string;
  clientId?: string;
  status?: InvoiceStatus;
}) {
  const conds = [eq(invoices.agencyId, params.agencyId)];
  if (params.clientId) conds.push(eq(invoices.clientId, params.clientId));
  // 'overdue' is derived: sent + past due. Other filters are literal.
  if (params.status === "overdue") {
    conds.push(eq(invoices.status, "sent"), lt(invoices.dueDate, new Date()));
  } else if (params.status) {
    conds.push(eq(invoices.status, params.status));
  }
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conds))
    .orderBy(desc(invoices.createdAt));
  return rows.map((r) => ({ ...r, isOverdue: isOverdue(r) }));
}

export async function getInvoiceById(params: { agencyId: string; id: string }) {
  const invoice = await loadInvoice(db, params.agencyId, params.id);
  const [items, paymentRows] = await Promise.all([
    db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice.id))
      .orderBy(asc(invoiceLineItems.sortOrder)),
    db
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, invoice.id))
      .orderBy(asc(payments.createdAt)),
  ]);
  const paidTotal = round2(
    paymentRows.filter((p) => p.status === "succeeded").reduce((s, p) => s + Number(p.amount), 0)
  );
  return { ...invoice, isOverdue: isOverdue(invoice), lineItems: items, payments: paymentRows, paidTotal };
}

/** Draft-only — an issued invoice is corrected by void + reissue, never edited. */
export async function updateInvoice(params: { agencyId: string; input: UpdateInvoiceInput }) {
  const { agencyId, input } = params;
  return txDb.transaction(async (tx) => {
    const invoice = await loadInvoice(tx, agencyId, input.id);
    if (invoice.status !== "draft") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only draft invoices can be edited. Void and reissue to correct a sent invoice.",
      });
    }

    const set: Partial<typeof invoices.$inferInsert> = {};
    if (input.dueDate !== undefined) set.dueDate = input.dueDate ? new Date(input.dueDate) : null;

    let subtotal = Number(invoice.subtotal);
    let tax = Number(invoice.tax);
    if (input.lineItems !== undefined) {
      await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id));
      const rows = itemRows(agencyId, invoice.id, input.lineItems);
      if (rows.length) await tx.insert(invoiceLineItems).values(rows);
      subtotal = sumItems(input.lineItems);
      set.subtotal = money(subtotal);
    }
    if (input.tax !== undefined) tax = input.tax;
    if (input.tax !== undefined) set.tax = money(tax);
    if (input.lineItems !== undefined || input.tax !== undefined) {
      set.total = money(subtotal + tax);
    }

    if (Object.keys(set).length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
    }

    const [updated] = await tx.update(invoices).set(set).where(eq(invoices.id, invoice.id)).returning();
    return updated;
  });
}

const generateToken = () => randomBytes(32).toString("base64url");

/** draft -> sent; mints the public token, stamps sentAt. */
export async function sendInvoice(params: { agencyId: string; id: string }) {
  const { agencyId, id } = params;
  const invoice = await loadInvoice(db, agencyId, id);
  if (invoice.status !== "draft") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invoice has already been sent." });
  }
  await assertEntityLive(db, agencyId, "client", invoice.clientId);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [updated] = await db
        .update(invoices)
        .set({ status: "sent", sentAt: new Date(), publicToken: generateToken() })
        .where(and(eq(invoices.id, id), eq(invoices.status, "draft")))
        .returning();
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "This invoice has already been sent." });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not generate an invoice link." });
}

/**
 * The financial correction: draft|sent -> void. paid is terminal (un-pay via
 * markPaymentRefunded first if the payment itself was the mistake). A sent
 * invoice with succeeded payments can't be voided — refund them first, so
 * received money is never orphaned on a voided document. Voids keep their
 * number (gapless sequence).
 */
export async function voidInvoice(params: { agencyId: string; id: string }) {
  const { agencyId, id } = params;
  return txDb.transaction(async (tx) => {
    await lockKey(tx, "invoice-payment", id); // serialize against recordPayment
    const invoice = await loadInvoice(tx, agencyId, id);
    if (invoice.status !== "draft" && invoice.status !== "sent") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `A ${invoice.status} invoice can't be voided.`,
      });
    }
    if ((await paidSum(tx, id)) > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Refund its payments before voiding this invoice.",
      });
    }
    const [updated] = await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, id)).returning();
    return updated;
  });
}

/**
 * Manual payment. Advisory-locked per invoice (check-then-act on the running
 * total): overpayment is rejected, so sum(succeeded) <= total always holds;
 * reaching the total flips the invoice to paid.
 */
export async function recordPayment(params: { agencyId: string; input: RecordPaymentInput }) {
  const { agencyId, input } = params;
  return txDb.transaction(async (tx) => {
    await lockKey(tx, "invoice-payment", input.invoiceId);
    const invoice = await loadInvoice(tx, agencyId, input.invoiceId);
    if (invoice.status !== "sent") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          invoice.status === "draft"
            ? "Send the invoice before recording payments."
            : `Can't record a payment on a ${invoice.status} invoice.`,
      });
    }

    const paid = await paidSum(tx, invoice.id);
    const remaining = round2(Number(invoice.total) - paid);
    if (input.amount > remaining) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Amount exceeds the remaining balance (${remaining.toFixed(2)}).`,
      });
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        agencyId,
        invoiceId: invoice.id,
        amount: money(input.amount),
        status: "succeeded", // manual record — Stripe fields stay null
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      })
      .returning();

    const nowPaid = round2(paid + input.amount);
    if (nowPaid >= Number(invoice.total)) {
      await tx.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoice.id));
    }
    return payment;
  });
}

/**
 * The append-only correction for a fat-fingered payment: succeeded -> refunded,
 * recomputing the invoice's paid-ness (a paid invoice whose payments drop below
 * total un-pays back to sent). Same lock as recordPayment.
 */
export async function markPaymentRefunded(params: { agencyId: string; paymentId: string }) {
  const { agencyId, paymentId } = params;
  return txDb.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.agencyId, agencyId)))
      .limit(1);
    if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });

    await lockKey(tx, "invoice-payment", payment.invoiceId);
    if (payment.status !== "succeeded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only a succeeded payment can be refunded." });
    }

    const [updated] = await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.id, paymentId))
      .returning();

    const invoice = await loadInvoice(tx, agencyId, payment.invoiceId);
    const paid = await paidSum(tx, invoice.id);
    if (invoice.status === "paid" && paid < Number(invoice.total)) {
      await tx.update(invoices).set({ status: "sent" }).where(eq(invoices.id, invoice.id));
    }
    return updated;
  });
}
