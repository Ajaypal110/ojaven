"use client";

import { useState } from "react";
import type { EntityType } from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.875rem" } as const;
const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  border: "1px solid #333",
  borderRadius: 999,
  padding: "0.15rem 0.6rem",
  fontSize: "0.85rem",
} as const;

export function TagsSection({
  entityType,
  entityId,
  canStructure,
}: {
  entityType: EntityType;
  entityId: string;
  canStructure: boolean;
}) {
  const utils = trpc.useUtils();
  const attached = trpc.tags.listForEntity.useQuery({ entityType, entityId });
  const allTags = trpc.tags.list.useQuery();
  const [showManager, setShowManager] = useState(false);

  const invalidateAttached = () => utils.tags.listForEntity.invalidate({ entityType, entityId });
  const attach = trpc.tags.attach.useMutation({ onSuccess: invalidateAttached });
  const detach = trpc.tags.detach.useMutation({ onSuccess: invalidateAttached });

  const attachedIds = new Set((attached.data ?? []).map((t) => t.id));
  const available = (allTags.data ?? []).filter((t) => !attachedIds.has(t.id));

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Tags</h2>
        {/* Structure control — owner/admin only. The server (teamProcedure)
            enforces this regardless; this just hides what an operator can't use. */}
        {canStructure && (
          <button type="button" onClick={() => setShowManager((s) => !s)}>
            {showManager ? "Done" : "Manage tags"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
        {(attached.data ?? []).map((t) => (
          <span key={t.id} style={chip}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: t.color ?? "#9CA3AF",
                display: "inline-block",
              }}
            />
            {t.name}
            <button
              type="button"
              aria-label={`Remove ${t.name}`}
              style={{ border: "none", background: "none", cursor: "pointer", color: "#888" }}
              onClick={() => detach.mutate({ tagId: t.id, entityType, entityId })}
            >
              ✕
            </button>
          </span>
        ))}
        {!attached.isLoading && attached.data?.length === 0 && <span style={muted}>No tags yet.</span>}
      </div>

      {/* Attach control — data op, all roles. */}
      {available.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) attach.mutate({ tagId: e.target.value, entityType, entityId });
            }}
          >
            <option value="">+ Add tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {attach.error && <p style={warn}>{attach.error.message}</p>}

      {canStructure && showManager && <TagManager />}
    </section>
  );
}

/** Owner/admin tag definition management (create / rename / recolor / delete). */
function TagManager() {
  const utils = trpc.useUtils();
  const tags = trpc.tags.list.useQuery();
  // Invalidate the whole tags router: list + every listForEntity (a deleted
  // tag's chips must vanish too, since delete cascades entityTags).
  const invalidate = () => utils.tags.invalidate();

  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const create = trpc.tags.create.useMutation({
    onSuccess: async () => {
      await invalidate();
      setName("");
    },
  });

  return (
    <div style={{ marginTop: "1rem", border: "1px solid #333", borderRadius: 6, padding: "0.75rem" }}>
      <p style={{ ...muted, marginTop: 0 }}>Manage tag definitions (owner/admin)</p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button
          type="button"
          disabled={create.isPending || name.trim() === ""}
          onClick={() => create.mutate({ name, color })}
        >
          {create.isPending ? "Creating…" : "Create tag"}
        </button>
      </div>
      {create.error && <p style={warn}>{create.error.message}</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem", display: "grid", gap: "0.4rem" }}>
        {(tags.data ?? []).map((t) => (
          <TagManagerRow key={t.id} tag={t} onChanged={invalidate} />
        ))}
      </ul>
    </div>
  );
}

function TagManagerRow({
  tag,
  onChanged,
}: {
  tag: { id: string; name: string; color: string | null };
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? "#3B82F6");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = trpc.tags.update.useMutation({ onSuccess: onChanged });
  const del = trpc.tags.delete.useMutation({ onSuccess: onChanged });

  return (
    <li style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "10rem" }} />
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <button
        type="button"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: tag.id, name, color })}
      >
        Save
      </button>
      {confirmDelete ? (
        <>
          <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: tag.id })}>
            {del.isPending ? "Deleting…" : "Confirm (removes it everywhere)"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      )}
      {(update.error || del.error) && (
        <span style={warn}>{(update.error ?? del.error)?.message}</span>
      )}
    </li>
  );
}
