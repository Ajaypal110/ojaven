"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export function ProposalView({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const proposal = trpc.public.getProposal.useQuery({ token }, { retry: false });
  const markViewed = trpc.public.markProposalViewed.useMutation();
  const respond = trpc.public.respondToProposal.useMutation({
    // On success OR an already-responded CONFLICT, re-read to show final state.
    onSettled: () => utils.public.getProposal.invalidate({ token }),
  });

  const [signedByName, setSignedByName] = useState("");
  const viewedFired = useRef(false);

  // Fire view tracking once on load (sent -> viewed). Best-effort.
  useEffect(() => {
    if (!viewedFired.current && proposal.data) {
      viewedFired.current = true;
      markViewed.mutate({ token });
    }
  }, [proposal.data, markViewed, token]);

  if (proposal.isLoading) {
    return <Shell><p style={{ color: "#666" }}>Loading…</p></Shell>;
  }
  if (proposal.error || !proposal.data) {
    return (
      <Shell>
        <h1 style={{ fontSize: "1.25rem" }}>Proposal not found</h1>
        <p style={{ color: "#666" }}>This link may be invalid or the proposal is no longer available.</p>
      </Shell>
    );
  }

  const p = proposal.data;
  const accent = p.primaryColor || "#111827";
  const canRespond = p.status === "sent" || p.status === "viewed";

  return (
    <Shell accent={accent}>
      {/* Agency branding ONLY — no Ojaven branding anywhere (stealth-safe). */}
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.logoUrl} alt={p.agencyName} style={{ height: 40, width: "auto" }} />
        ) : null}
        <strong style={{ fontSize: "1.1rem" }}>{p.agencyName}</strong>
      </header>

      <h1 style={{ fontSize: "1.6rem", margin: "0 0 1rem", color: accent }}>{p.title}</h1>

      {/* bodyHtml is sanitized server-side at write (allowlist) — safe to render. */}
      <div className="proposal-body" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />

      {p.lineItems.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "1.5rem 0" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ padding: "0.5rem 0" }}>Item</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "0.5rem", textAlign: "right" }}>Unit</th>
              <th style={{ padding: "0.5rem 0", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {p.lineItems.map((li, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "0.5rem 0" }}>{li.description}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{Number(li.quantity)}</td>
                <td style={{ padding: "0.5rem", textAlign: "right" }}>{money(Number(li.unitPrice))}</td>
                <td style={{ padding: "0.5rem 0", textAlign: "right" }}>{money(Number(li.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ textAlign: "right", fontSize: "1.25rem", fontWeight: 700, marginBottom: "2rem" }}>
        Total: {money(Number(p.value))}
      </div>

      {/* State-dependent action area. */}
      {p.status === "accepted" && (
        <Banner ok>Accepted{p.signedByName ? ` by ${p.signedByName}` : ""}{p.respondedAt ? ` on ${new Date(p.respondedAt).toLocaleDateString()}` : ""}.</Banner>
      )}
      {p.status === "declined" && <Banner>This proposal was declined.</Banner>}
      {p.status === "expired" && <Banner>This proposal has expired.</Banner>}

      {canRespond && (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.5rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>
            Type your full name to accept
            <input
              value={signedByName}
              onChange={(e) => setSignedByName(e.target.value)}
              placeholder="Your name"
              style={{ display: "block", marginTop: "0.35rem", padding: "0.5rem", width: "100%", maxWidth: "320px", border: "1px solid #d1d5db", borderRadius: 6 }}
            />
          </label>
          {respond.error && <p style={{ color: "#b91c1c" }}>{respond.error.message}</p>}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              disabled={respond.isPending || signedByName.trim() === ""}
              onClick={() => respond.mutate({ token, decision: "accept", signedByName })}
              style={{ background: accent, color: "#fff", border: "none", borderRadius: 6, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 600 }}
            >
              {respond.isPending ? "Submitting…" : "Accept proposal"}
            </button>
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ token, decision: "decline" })}
              style={{ background: "transparent", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "0.6rem 1.2rem", cursor: "pointer" }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Banner({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div style={{ padding: "0.75rem 1rem", borderRadius: 6, background: ok ? "#ecfdf5" : "#f3f4f6", color: ok ? "#065f46" : "#374151", fontWeight: 600 }}>
      {children}
    </div>
  );
}

function Shell({ children, accent = "#111827" }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", padding: "2rem 1rem" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: "2rem", color: "#1f2937", lineHeight: 1.6 }}>
        {children}
      </div>
      {/* Style tag scopes basic formatting for the sanitized body. */}
      <style>{`.proposal-body h1,.proposal-body h2,.proposal-body h3{color:${accent};margin:1rem 0 0.5rem}.proposal-body p{margin:0.5rem 0}.proposal-body ul,.proposal-body ol{padding-left:1.25rem}.proposal-body a{color:${accent}}`}</style>
    </div>
  );
}
