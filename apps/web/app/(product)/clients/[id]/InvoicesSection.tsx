"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type Outputs = inferRouterOutputs<AppRouter>;
type InvoiceSummary = Outputs["invoices"]["list"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.85rem" } as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

type LineItem = { description: string; quantity: string; unitPrice: string };
const emptyItem: LineItem = { description: "", quantity: "1", unitPrice: "0" };

const STATUS_COLOR: Record<string, string> = {
  draft: "#888",
  sent: "#3B82F6",
  paid: "#3FB950",
  void: "#666",
  overdue: "#D97706",
};

export function InvoicesSection({ clientId }: { clientId: string }) {
  const team = trpc.team.list.useQuery();
  const list = trpc.invoices.list.useQuery({ clientId });
  const accepted = trpc.proposals.list.useQuery({ clientId, status: "accepted" });
  const [creating, setCreating] = useState(false);

  const canCorrect =
    team.data?.callerRole === "owner" || team.data?.callerRole === "admin";

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Invoices</h2>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            New invoice
          </button>
        )}
      </div>

      {(accepted.data?.length ?? 0) > 0 && <ConvertControl clientId={clientId} accepted={accepted.data!} />}
      {creating && <InvoiceForm clientId={clientId} onDone={() => setCreating(false)} />}

      {list.isLoading && <p style={muted}>Loading…</p>}
      {!list.isLoading && list.data?.length === 0 && !creating && <p style={muted}>No invoices yet.</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(list.data ?? []).map((inv) => (
          <InvoiceRow key={inv.id} invoice={inv} clientId={clientId} canCorrect={canCorrect} />
        ))}
      </ul>
    </section>
  );
}

/** Accepted proposals -> one-click conversion (the A6 structured-items payoff). */
function ConvertControl({ clientId, accepted }: { clientId: string; accepted: Outputs["proposals"]["list"] }) {
  const utils = trpc.useUtils();
  const [proposalId, setProposalId] = useState("");
  const convert = trpc.invoices.convertFromProposal.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate({ clientId });
      setProposalId("");
    },
  });
  return (
    <div style={{ ...card, marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <span style={muted}>Convert accepted proposal:</span>
      <select value={proposalId} onChange={(e) => setProposalId(e.target.value)}>
        <option value="">Choose…</option>
        {accepted.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title} ({money(p.value)})
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={convert.isPending || !proposalId}
        onClick={() => convert.mutate({ proposalId, tax: 0 })}
      >
        {convert.isPending ? "Converting…" : "Convert to invoice"}
      </button>
      {convert.error && <span style={warn}>{convert.error.message}</span>}
    </div>
  );
}

function InvoiceRow({
  invoice,
  clientId,
  canCorrect,
}: {
  invoice: InvoiceSummary;
  clientId: string;
  canCorrect: boolean;
}) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const refresh = () => utils.invoices.invalidate();

  const send = trpc.invoices.send.useMutation({ onSuccess: refresh });
  const voidInv = trpc.invoices.void.useMutation({ onSuccess: refresh });

  const link =
    invoice.publicToken && typeof window !== "undefined"
      ? `${window.location.origin}/i/${invoice.publicToken}`
      : null;
  const statusLabel = invoice.isOverdue ? "overdue" : invoice.status;

  if (editing) {
    return (
      <li>
        <EditInvoice invoiceId={invoice.id} clientId={clientId} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
        <strong>{invoice.invoiceNumber}</strong>
        <span style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
          <span>{money(invoice.total)}</span>
          <span style={{ color: STATUS_COLOR[statusLabel], fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase" }}>
            {statusLabel}
          </span>
        </span>
      </div>
      {invoice.dueDate && (
        <div style={muted}>due {new Date(invoice.dueDate).toLocaleDateString()}</div>
      )}

      {link && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
          <input readOnly value={link} style={{ flex: 1, fontSize: "0.8rem" }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
        {invoice.status === "draft" && (
          <>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" disabled={send.isPending} onClick={() => send.mutate({ id: invoice.id })}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </>
        )}
        <button type="button" onClick={() => setExpanded((s) => !s)}>
          {expanded ? "Hide details" : "Details"}
        </button>
        {canCorrect && (invoice.status === "draft" || invoice.status === "sent") && (
          <button type="button" disabled={voidInv.isPending} onClick={() => voidInv.mutate({ id: invoice.id })}>
            {voidInv.isPending ? "Voiding…" : "Void"}
          </button>
        )}
      </div>
      {(send.error || voidInv.error) && <p style={warn}>{(send.error ?? voidInv.error)?.message}</p>}

      {expanded && <InvoiceDetails invoiceId={invoice.id} canCorrect={canCorrect} />}
    </li>
  );
}

/** Expanded: line items, payments (+refund), paid/remaining, record-payment. */
function InvoiceDetails({ invoiceId, canCorrect }: { invoiceId: string; canCorrect: boolean }) {
  const utils = trpc.useUtils();
  const full = trpc.invoices.byId.useQuery({ id: invoiceId });
  const [amount, setAmount] = useState("");
  const refresh = () => utils.invoices.invalidate();

  const record = trpc.invoices.recordPayment.useMutation({
    onSuccess: () => {
      refresh();
      setAmount("");
    },
  });
  const refund = trpc.invoices.markPaymentRefunded.useMutation({ onSuccess: refresh });

  if (full.isLoading) return <p style={muted}>Loading…</p>;
  if (!full.data) return null;
  const inv = full.data;
  const remaining = Number(inv.total) - inv.paidTotal;

  return (
    <div style={{ marginTop: "0.75rem", borderTop: "1px dashed #333", paddingTop: "0.75rem" }}>
      {inv.lineItems.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.2rem" }}>
          {inv.lineItems.map((li) => (
            <li key={li.id} style={muted}>
              {li.description} — {Number(li.quantity)} × {money(li.unitPrice)} = {money(li.amount)}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: "0.4rem" }}>
        {money(inv.subtotal)} subtotal · {money(inv.tax)} tax · <strong>{money(inv.total)} total</strong>
        {" · "}
        <span style={{ color: inv.paidTotal > 0 ? "#3FB950" : "#888" }}>{money(inv.paidTotal)} paid</span>
        {inv.status !== "paid" && <span style={muted}> · {money(remaining)} remaining</span>}
      </div>

      {inv.payments.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem", display: "grid", gap: "0.3rem" }}>
          {inv.payments.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={p.status === "refunded" ? { ...muted, textDecoration: "line-through" } : undefined}>
                {money(p.amount)} · {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : ""} · {p.status}
              </span>
              {canCorrect && p.status === "succeeded" && (
                <button type="button" disabled={refund.isPending} onClick={() => refund.mutate({ paymentId: p.id })}>
                  Refund
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {refund.error && <p style={warn}>{refund.error.message}</p>}

      {inv.status === "sent" && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", alignItems: "center" }}>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: "8rem" }}
          />
          <button
            type="button"
            disabled={record.isPending || amount.trim() === ""}
            onClick={() => record.mutate({ invoiceId, amount: Number(amount) })}
          >
            {record.isPending ? "Recording…" : "Record payment"}
          </button>
          {record.error && <span style={warn}>{record.error.message}</span>}
        </div>
      )}
    </div>
  );
}

function EditInvoice({ invoiceId, clientId, onDone }: { invoiceId: string; clientId: string; onDone: () => void }) {
  const full = trpc.invoices.byId.useQuery({ id: invoiceId });
  if (full.isLoading) return <div style={card}>Loading…</div>;
  if (!full.data) return <div style={card}>Not found.</div>;
  return (
    <InvoiceForm
      clientId={clientId}
      onDone={onDone}
      existing={{
        id: full.data.id,
        tax: String(Number(full.data.tax)),
        dueDate: full.data.dueDate ? new Date(full.data.dueDate).toISOString().slice(0, 10) : "",
        lineItems: full.data.lineItems.map((li) => ({
          description: li.description,
          quantity: String(Number(li.quantity)),
          unitPrice: String(Number(li.unitPrice)),
        })),
      }}
    />
  );
}

function InvoiceForm({
  clientId,
  onDone,
  existing,
}: {
  clientId: string;
  onDone: () => void;
  existing?: { id: string; tax: string; dueDate: string; lineItems: LineItem[] };
}) {
  const utils = trpc.useUtils();
  const [items, setItems] = useState<LineItem[]>(existing?.lineItems.length ? existing.lineItems : [{ ...emptyItem }]);
  const [tax, setTax] = useState(existing?.tax ?? "0");
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? "");

  const done = () => {
    utils.invoices.invalidate();
    onDone();
  };
  const create = trpc.invoices.create.useMutation({ onSuccess: done });
  const update = trpc.invoices.update.useMutation({ onSuccess: done });
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const setItem = (i: number, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  const subtotal = items.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const total = subtotal + (Number(tax) || 0);

  const submit = () => {
    const lineItems = items
      .filter((li) => li.description.trim() !== "")
      .map((li) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }));
    const payload = {
      lineItems,
      tax: Number(tax) || 0,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    };
    if (existing) update.mutate({ id: existing.id, ...payload });
    else create.mutate({ clientId, ...payload });
  };

  return (
    <div style={{ ...card, marginTop: "1rem", display: "grid", gap: "0.6rem" }}>
      <div style={muted}>Line items</div>
      {items.map((li, i) => (
        <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="Description" value={li.description} onChange={(e) => setItem(i, { description: e.target.value })} style={{ flex: 1, minWidth: "8rem" }} />
          <input type="number" min="0" step="0.5" value={li.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} style={{ width: "5rem" }} />
          <span style={muted}>×</span>
          <input type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} style={{ width: "7rem" }} />
          <button type="button" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      <div>
        <button type="button" onClick={() => setItems((prev) => [...prev, { ...emptyItem }])}>+ Add line item</button>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.3rem" }}>
          Tax <input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} style={{ width: "6rem" }} />
        </label>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: "0.3rem" }}>
          Due <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <strong>Total: {money(total)}</strong>
      </div>
      {error && <p style={warn}>{error.message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : existing ? "Save" : "Create draft"}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
