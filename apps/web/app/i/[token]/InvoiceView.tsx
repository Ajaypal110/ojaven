"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc/client";

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function InvoiceView({ token }: { token: string }) {
  const invoice = trpc.public.getInvoice.useQuery({ token }, { retry: false });
  const markViewed = trpc.public.markInvoiceViewed.useMutation();
  const viewedFired = useRef(false);

  useEffect(() => {
    if (!viewedFired.current && invoice.data) {
      viewedFired.current = true;
      markViewed.mutate({ token });
    }
  }, [invoice.data, markViewed, token]);

  if (invoice.isLoading) {
    return <Shell><p style={{ color: "#666" }}>Loading…</p></Shell>;
  }
  if (invoice.error || !invoice.data) {
    return (
      <Shell>
        <h1 style={{ fontSize: "1.25rem" }}>Invoice not found</h1>
        <p style={{ color: "#666" }}>This link may be invalid or the invoice is no longer available.</p>
      </Shell>
    );
  }

  const inv = invoice.data;
  const accent = inv.primaryColor || "#111827";
  const remaining = Number(inv.total) - inv.paidTotal;

  return (
    <Shell>
      {/* Agency branding ONLY — no Ojaven anywhere (stealth-safe). */}
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {inv.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={inv.logoUrl} alt={inv.agencyName} style={{ height: 40, width: "auto" }} />
        ) : null}
        <strong style={{ fontSize: "1.1rem" }}>{inv.agencyName}</strong>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", margin: 0, color: accent }}>Invoice {inv.invoiceNumber}</h1>
        <StatusBadge status={inv.status} isOverdue={inv.isOverdue} />
      </div>
      <div style={{ color: "#6b7280", margin: "0.5rem 0 1.5rem" }}>
        {inv.sentAt && <>Issued {new Date(inv.sentAt).toLocaleDateString()}</>}
        {inv.dueDate && <> · Due {new Date(inv.dueDate).toLocaleDateString()}</>}
      </div>

      {inv.status === "void" && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 6, background: "#f3f4f6", color: "#374151", fontWeight: 600, marginBottom: "1.5rem" }}>
          This invoice has been voided and no longer requires payment.
        </div>
      )}

      {inv.lineItems.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ padding: "0.5rem 0" }}>Item</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Unit</th>
              <th style={{ padding: "0.5rem 0", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lineItems.map((li, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "0.5rem 0" }}>{li.description}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{Number(li.quantity)}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{money(li.unitPrice)}</td>
                <td style={{ padding: "0.5rem 0", textAlign: "right" }}>{money(li.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginLeft: "auto", maxWidth: "280px", display: "grid", gap: "0.25rem" }}>
        <Row label="Subtotal" value={money(inv.subtotal)} />
        <Row label="Tax" value={money(inv.tax)} />
        <Row label="Total" value={money(inv.total)} strong />
        {inv.paidTotal > 0 && <Row label="Paid" value={money(inv.paidTotal)} color="#065f46" />}
        {inv.status === "sent" && inv.paidTotal > 0 && (
          <Row label="Balance due" value={money(remaining)} strong color={inv.isOverdue ? "#b45309" : undefined} />
        )}
      </div>

      {inv.status === "paid" && (
        <div style={{ marginTop: "1.5rem", padding: "0.75rem 1rem", borderRadius: 6, background: "#ecfdf5", color: "#065f46", fontWeight: 600 }}>
          Paid in full — thank you.
        </div>
      )}
    </Shell>
  );
}

function StatusBadge({ status, isOverdue }: { status: string; isOverdue: boolean }) {
  const label = isOverdue ? "OVERDUE" : status.toUpperCase();
  const colors: Record<string, { bg: string; fg: string }> = {
    SENT: { bg: "#eff6ff", fg: "#1d4ed8" },
    PAID: { bg: "#ecfdf5", fg: "#065f46" },
    VOID: { bg: "#f3f4f6", fg: "#4b5563" },
    OVERDUE: { bg: "#fffbeb", fg: "#b45309" },
  };
  const c = colors[label] ?? colors.SENT!;
  return (
    <span style={{ background: c.bg, color: c.fg, fontWeight: 700, fontSize: "0.8rem", padding: "0.25rem 0.6rem", borderRadius: 999 }}>
      {label}
    </span>
  );
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 700 : 400, color }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: "2rem", color: "#1f2937", lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}
