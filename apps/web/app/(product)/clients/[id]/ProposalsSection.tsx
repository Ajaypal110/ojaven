"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type Outputs = inferRouterOutputs<AppRouter>;
type ProposalSummary = Outputs["proposals"]["list"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.85rem" } as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;

type LineItem = { description: string; quantity: string; unitPrice: string };
const emptyItem: LineItem = { description: "", quantity: "1", unitPrice: "0" };
const money = (n: number) => `$${n.toFixed(2)}`;
const lineTotal = (items: LineItem[]) =>
  items.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);

const STATUS_COLOR: Record<string, string> = {
  draft: "#888",
  sent: "#3B82F6",
  viewed: "#8B5CF6",
  accepted: "#3FB950",
  declined: "#D97706",
  expired: "#888",
};

export function ProposalsSection({ clientId }: { clientId: string }) {
  const list = trpc.proposals.list.useQuery({ clientId });
  const [creating, setCreating] = useState(false);

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Proposals</h2>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            New proposal
          </button>
        )}
      </div>

      {creating && (
        <ProposalForm clientId={clientId} onDone={() => setCreating(false)} />
      )}

      {list.isLoading && <p style={muted}>Loading…</p>}
      {!list.isLoading && list.data?.length === 0 && !creating && (
        <p style={muted}>No proposals yet.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(list.data ?? []).map((p) => (
          <ProposalRow key={p.id} proposal={p} clientId={clientId} />
        ))}
      </ul>
    </section>
  );
}

function ProposalRow({ proposal, clientId }: { proposal: ProposalSummary; clientId: string }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => utils.proposals.list.invalidate({ clientId });

  const send = trpc.proposals.send.useMutation({ onSuccess: refresh });
  const del = trpc.proposals.delete.useMutation({
    onSuccess: () => {
      refresh();
      setConfirmDelete(false);
    },
  });

  const link =
    proposal.publicToken && typeof window !== "undefined"
      ? `${window.location.origin}/p/${proposal.publicToken}`
      : null;

  if (editing) {
    return (
      <li>
        <EditProposal proposalId={proposal.id} clientId={clientId} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
        <strong>{proposal.title}</strong>
        <span style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
          <span>{money(Number(proposal.value))}</span>
          <span style={{ color: STATUS_COLOR[proposal.status], fontWeight: 600, fontSize: "0.8rem", textTransform: "uppercase" }}>
            {proposal.status}
          </span>
        </span>
      </div>

      {proposal.status === "accepted" && proposal.signedByName && (
        <div style={{ ...muted, marginTop: "0.25rem", color: "#3FB950" }}>
          Accepted by {proposal.signedByName}
        </div>
      )}

      {link && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
          <input readOnly value={link} style={{ flex: 1, fontSize: "0.8rem" }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>
            Copy link
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
        {proposal.status === "draft" && (
          <>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" disabled={send.isPending} onClick={() => send.mutate({ id: proposal.id })}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </>
        )}
        {proposal.status !== "accepted" && (
          confirmDelete ? (
            <>
              <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: proposal.id })}>
                {del.isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
          )
        )}
      </div>
      {(send.error || del.error) && <p style={warn}>{(send.error ?? del.error)?.message}</p>}
    </li>
  );
}

/** Fetches the full proposal (with line items) and renders the edit form. */
function EditProposal({ proposalId, clientId, onDone }: { proposalId: string; clientId: string; onDone: () => void }) {
  const full = trpc.proposals.byId.useQuery({ id: proposalId });
  if (full.isLoading) return <div style={card}>Loading…</div>;
  if (!full.data) return <div style={card}>Not found.</div>;
  return (
    <ProposalForm
      clientId={clientId}
      onDone={onDone}
      existing={{
        id: full.data.id,
        title: full.data.title,
        bodyHtml: full.data.bodyHtml,
        lineItems: full.data.lineItems.map((li) => ({
          description: li.description,
          quantity: String(Number(li.quantity)),
          unitPrice: String(Number(li.unitPrice)),
        })),
      }}
    />
  );
}

function ProposalForm({
  clientId,
  onDone,
  existing,
}: {
  clientId: string;
  onDone: () => void;
  existing?: { id: string; title: string; bodyHtml: string; lineItems: LineItem[] };
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(existing?.bodyHtml ?? "");
  const [items, setItems] = useState<LineItem[]>(
    existing?.lineItems.length ? existing.lineItems : [{ ...emptyItem }]
  );

  const done = () => {
    utils.proposals.list.invalidate({ clientId });
    if (existing) utils.proposals.byId.invalidate({ id: existing.id });
    onDone();
  };
  const create = trpc.proposals.create.useMutation({ onSuccess: done });
  const update = trpc.proposals.update.useMutation({ onSuccess: done });
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const setItem = (i: number, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));

  const submit = () => {
    const lineItems = items
      .filter((li) => li.description.trim() !== "")
      .map((li) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }));
    const payload = { title, bodyHtml, lineItems };
    if (existing) update.mutate({ id: existing.id, ...payload });
    else create.mutate({ clientId, ...payload });
  };

  return (
    <div style={{ ...card, marginTop: "1rem", display: "grid", gap: "0.6rem" }}>
      <input placeholder="Proposal title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        placeholder="Body (basic HTML allowed; sanitized)"
        rows={4}
        value={bodyHtml}
        onChange={(e) => setBodyHtml(e.target.value)}
        style={{ resize: "vertical" }}
      />

      <div style={muted}>Line items</div>
      {items.map((li, i) => (
        <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="Description" value={li.description} onChange={(e) => setItem(i, { description: e.target.value })} style={{ flex: 1, minWidth: "8rem" }} />
          <input type="number" min="0" step="0.5" placeholder="qty" value={li.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} style={{ width: "5rem" }} />
          <span style={muted}>×</span>
          <input type="number" min="0" step="0.01" placeholder="price" value={li.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} style={{ width: "7rem" }} />
          <span style={muted}>= {money((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0))}</span>
          <button type="button" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      <div>
        <button type="button" onClick={() => setItems((prev) => [...prev, { ...emptyItem }])}>+ Add line item</button>
        <strong style={{ marginLeft: "1rem" }}>Total: {money(lineTotal(items))}</strong>
      </div>

      {error && <p style={warn}>{error.message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" disabled={pending || title.trim() === ""} onClick={submit}>
          {pending ? "Saving…" : existing ? "Save" : "Create draft"}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
