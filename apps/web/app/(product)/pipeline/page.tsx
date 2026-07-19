"use client";

// KNOWN ITEM: drag-and-drop here is native HTML5 DnD — desktop/mouse only.
// Mobile/tablet (and the future Expo app) needs its own drag implementation.
// Logged in KNOWN_ITEMS.md.

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

const err = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.875rem" } as const;

export default function PipelinePage() {
  const utils = trpc.useUtils();

  const membership = trpc.team.myMembership.useQuery();
  const pipelines = trpc.pipeline.list.useQuery();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedPipeline =
    pipelines.data?.find((p) => p.id === selectedId) ??
    pipelines.data?.find((p) => p.isDefault) ??
    pipelines.data?.[0];

  const deals = trpc.deals.list.useQuery(
    { pipelineId: selectedPipeline?.id },
    { enabled: Boolean(selectedPipeline) }
  );
  const clients = trpc.clients.list.useQuery();

  const invalidateStructure = () => utils.pipeline.list.invalidate();
  const invalidateDeals = () => utils.deals.list.invalidate();

  const ensureDefault = trpc.pipeline.ensureDefault.useMutation({ onSuccess: invalidateStructure });
  const createStage = trpc.pipeline.createStage.useMutation({
    onSuccess: () => {
      invalidateStructure();
      setNewStageName("");
    },
  });
  const reorderStages = trpc.pipeline.reorderStages.useMutation({ onSuccess: invalidateStructure });
  const archiveStage = trpc.pipeline.archiveStage.useMutation({
    onSuccess: () => {
      invalidateStructure();
      setConfirmingArchiveId(null);
    },
  });

  const createDeal = trpc.deals.create.useMutation({
    onSuccess: () => {
      invalidateDeals();
      setDealName("");
      setDealValue("");
    },
  });
  const moveStage = trpc.deals.moveStage.useMutation({ onSuccess: invalidateDeals });
  const setStatus = trpc.deals.setStatus.useMutation({ onSuccess: invalidateDeals });
  const deleteDeal = trpc.deals.delete.useMutation({ onSuccess: invalidateDeals });

  const [dealClientId, setDealClientId] = useState("");
  const [dealName, setDealName] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [confirmingArchiveId, setConfirmingArchiveId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const canStructure =
    membership.data?.role === "owner" || membership.data?.role === "admin";

  const mutationError =
    ensureDefault.error ??
    createStage.error ??
    reorderStages.error ??
    archiveStage.error ??
    createDeal.error ??
    moveStage.error ??
    setStatus.error ??
    deleteDeal.error;

  // ---- loading / error / empty states, in that order --------------------

  if (pipelines.isLoading || membership.isLoading) {
    return <Shell><p>Loading…</p></Shell>;
  }
  if (pipelines.error) {
    return <Shell><p style={err}>Error: {pipelines.error.message}</p></Shell>;
  }

  // The cell most likely to be a broken dead-end, handled explicitly: an
  // operator/manager with zero pipelines gets a friendly explanation —
  // never a spinner, blank board, or error. Owner/admin get the CTA.
  if (pipelines.data && pipelines.data.length === 0) {
    return (
      <Shell>
        <p>No pipeline yet.</p>
        {canStructure ? (
          <>
            <button
              type="button"
              disabled={ensureDefault.isPending}
              onClick={() => ensureDefault.mutate()}
            >
              {ensureDefault.isPending ? "Creating…" : "Create default pipeline"}
            </button>
            {ensureDefault.error && <p style={err}>{ensureDefault.error.message}</p>}
          </>
        ) : (
          <p style={muted}>Ask an owner or admin to set one up.</p>
        )}
      </Shell>
    );
  }

  if (!selectedPipeline) return <Shell><p>Loading…</p></Shell>;

  const stages = selectedPipeline.stages;
  const allDeals = deals.data ?? [];
  const openDeals = allDeals.filter((deal) => deal.status === "open");
  const closedDeals = allDeals.filter((deal) => deal.status !== "open");
  const wonCount = closedDeals.filter((deal) => deal.status === "won").length;

  const moveColumn = (index: number, direction: -1 | 1) => {
    const ids = stages.map((stage) => stage.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderStages.mutate({ pipelineId: selectedPipeline.id, orderedStageIds: ids });
  };

  const onCreateDeal = () => {
    if (!dealClientId || !dealName.trim()) return;
    const parsedValue = dealValue.trim() === "" ? undefined : Number(dealValue);
    createDeal.mutate({
      clientId: dealClientId,
      name: dealName.trim(),
      value: Number.isFinite(parsedValue) ? parsedValue : undefined,
      pipelineId: selectedPipeline.id,
    });
  };

  return (
    <Shell>
      {pipelines.data && pipelines.data.length > 1 && (
        <p>
          <label htmlFor="pipeline-select">Pipeline: </label>
          <select
            id="pipeline-select"
            value={selectedPipeline.id}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {pipelines.data.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </select>
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "1rem 0" }}>
        <label htmlFor="deal-client" style={{ position: "absolute", left: "-9999px" }}>
          Client
        </label>
        <select id="deal-client" value={dealClientId} onChange={(e) => setDealClientId(e.target.value)}>
          <option value="">Select client…</option>
          {(clients.data ?? []).map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Deal name"
          placeholder="Deal name"
          value={dealName}
          onChange={(e) => setDealName(e.target.value)}
        />
        <input
          aria-label="Value"
          placeholder="Value"
          inputMode="decimal"
          style={{ width: "6rem" }}
          value={dealValue}
          onChange={(e) => setDealValue(e.target.value)}
        />
        <button type="button" disabled={createDeal.isPending} onClick={onCreateDeal}>
          {createDeal.isPending ? "Creating…" : "Create deal"}
        </button>
      </div>

      {mutationError && <p style={err}>{mutationError.message}</p>}
      {deals.error && <p style={err}>Error: {deals.error.message}</p>}

      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", overflowX: "auto" }}>
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStageId(stage.id);
            }}
            onDragLeave={() => setDragOverStageId(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStageId(null);
              const dealId = e.dataTransfer.getData("text/plain");
              const deal = openDeals.find((d) => d.id === dealId);
              if (!deal || deal.stageId === stage.id) return; // same column: pure no-op
              moveStage.mutate({ id: dealId, stageId: stage.id });
            }}
            style={{
              minWidth: "220px",
              padding: "0.5rem",
              border: `1px solid ${dragOverStageId === stage.id ? "#D97706" : "#333"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <strong style={{ flex: 1 }}>
                {stage.name} <span style={muted}>({stage.closeProbability}%)</span>
              </strong>
              {canStructure && (
                <>
                  <button type="button" aria-label={`Move ${stage.name} left`} disabled={index === 0 || reorderStages.isPending} onClick={() => moveColumn(index, -1)}>
                    ◀
                  </button>
                  <button type="button" aria-label={`Move ${stage.name} right`} disabled={index === stages.length - 1 || reorderStages.isPending} onClick={() => moveColumn(index, 1)}>
                    ▶
                  </button>
                  {confirmingArchiveId === stage.id ? (
                    <>
                      <button type="button" disabled={archiveStage.isPending} onClick={() => archiveStage.mutate({ stageId: stage.id })}>
                        Confirm
                      </button>
                      <button type="button" onClick={() => setConfirmingArchiveId(null)}>✕</button>
                    </>
                  ) : (
                    <button type="button" aria-label={`Archive ${stage.name}`} onClick={() => setConfirmingArchiveId(stage.id)}>
                      🗑
                    </button>
                  )}
                </>
              )}
            </div>

            {openDeals
              .filter((deal) => deal.stageId === stage.id)
              .map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
                  style={{
                    border: "1px solid #444",
                    padding: "0.5rem",
                    marginTop: "0.5rem",
                    cursor: "grab",
                    opacity: moveStage.isPending ? 0.5 : 1,
                  }}
                >
                  <div>{deal.name}</div>
                  <div style={muted}>{deal.clientName}</div>
                  <div style={muted}>${deal.value}</div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: deal.id, status: "won" })}>
                      Won
                    </button>
                    <button type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: deal.id, status: "lost" })}>
                      Lost
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ))}

        {canStructure && (
          <div style={{ minWidth: "180px", padding: "0.5rem" }}>
            <input
              aria-label="New stage name"
              placeholder="New stage"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
            />
            <button
              type="button"
              disabled={createStage.isPending || !newStageName.trim()}
              onClick={() =>
                createStage.mutate({ pipelineId: selectedPipeline.id, name: newStageName.trim() })
              }
            >
              + Add stage
            </button>
          </div>
        )}
      </div>

      <details style={{ marginTop: "1.5rem" }}>
        <summary>
          Closed deals ({wonCount} won · {closedDeals.length - wonCount} lost)
        </summary>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {closedDeals.map((deal) => (
            <li key={deal.id} style={{ display: "flex", gap: "0.75rem", padding: "0.5rem 0", borderBottom: "1px solid #333" }}>
              <span style={{ flex: 1 }}>
                {deal.name} <span style={muted}>{deal.clientName} · ${deal.value} · {deal.status}</span>
              </span>
              <button type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: deal.id, status: "open" })}>
                Reopen
              </button>
              <button type="button" disabled={deleteDeal.isPending} onClick={() => deleteDeal.mutate({ id: deal.id })}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2rem" }}>
      <Link href="/dashboard">&larr; Dashboard</Link>
      <h1 style={{ margin: "1rem 0" }}>Pipeline</h1>
      {children}
    </div>
  );
}
