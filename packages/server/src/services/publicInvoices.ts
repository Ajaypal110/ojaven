import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { agencies, agencySettings, db, invoiceLineItems, invoices, payments } from "@ojaven/db";

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Public display payload for /i/[token]. Drafts are unreachable (token only
 * mints on send anyway); wrong tokens get a uniform NOT_FOUND. Unlike
 * proposals, a VOIDED invoice stays visible — the client holds a link the
 * agency sent them, and "VOID" is information ("cancelled"), where a 404 would
 * read as a broken link. View-only: paying happens off-platform until Stripe.
 */
export async function getInvoiceByToken(token: string) {
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      dueDate: invoices.dueDate,
      sentAt: invoices.sentAt,
      agencyName: agencies.name,
      logoUrl: agencySettings.logoUrl,
      primaryColor: agencySettings.primaryColor,
    })
    .from(invoices)
    .innerJoin(agencies, eq(agencies.id, invoices.agencyId))
    .leftJoin(agencySettings, eq(agencySettings.agencyId, invoices.agencyId))
    .where(and(eq(invoices.publicToken, token), ne(invoices.status, "draft")))
    .limit(1);
  if (!row) throw notFound();

  const [items, paidRows] = await Promise.all([
    db
      .select({
        description: invoiceLineItems.description,
        quantity: invoiceLineItems.quantity,
        unitPrice: invoiceLineItems.unitPrice,
        amount: invoiceLineItems.amount,
      })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, row.id))
      .orderBy(asc(invoiceLineItems.sortOrder)),
    db
      .select({
        paid: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${payments.status} = 'succeeded'), 0)`,
      })
      .from(payments)
      .where(eq(payments.invoiceId, row.id)),
  ]);

  const isOverdue =
    row.status === "sent" && row.dueDate != null && row.dueDate.getTime() < Date.now();

  const paid = Number(paidRows[0]?.paid ?? 0);
  const { id: _id, ...display } = row; // internal id never leaves
  return { ...display, isOverdue, paidTotal: round2(paid), lineItems: items };
}

/** Best-effort first-view stamp; no status change (invoices have no 'viewed'). */
export async function markInvoiceViewed(token: string) {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.publicToken, token), ne(invoices.status, "draft")))
    .limit(1);
  if (!row) throw notFound();
  await db
    .update(invoices)
    .set({ viewedAt: new Date() })
    .where(and(eq(invoices.id, row.id), isNull(invoices.viewedAt)));
  return { ok: true as const };
}
