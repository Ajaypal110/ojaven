"use client";

import { useState } from "react";
import type { EntityType } from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";

const muted = { color: "#888", fontSize: "0.85rem" } as const;

/** Unified activity timeline — manual notes for now (author + time), newest first. */
export function ActivityTimeline({
  entityType,
  entityId,
}: {
  entityType: EntityType;
  entityId: string;
}) {
  const utils = trpc.useUtils();
  const activities = trpc.activities.listForEntity.useQuery({ entityType, entityId });
  const [body, setBody] = useState("");

  const add = trpc.activities.addNote.useMutation({
    onSuccess: async () => {
      await utils.activities.listForEntity.invalidate({ entityType, entityId });
      setBody("");
    },
  });

  const authorName = (a: {
    authorFirstName: string | null;
    authorLastName: string | null;
    authorEmail: string | null;
  }) => {
    const full = `${a.authorFirstName ?? ""} ${a.authorLastName ?? ""}`.trim();
    return full || a.authorEmail || "Unknown";
  };

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <h2 style={{ margin: 0 }}>Activity</h2>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <textarea
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          style={{ flex: 1, resize: "vertical" }}
        />
        <button type="button" disabled={add.isPending || body.trim() === ""} onClick={() => add.mutate({ entityType, entityId, body })}>
          {add.isPending ? "Posting…" : "Post note"}
        </button>
      </div>
      {add.error && <p style={{ color: "#D97706" }}>{add.error.message}</p>}

      {activities.isLoading && <p style={muted}>Loading…</p>}
      {!activities.isLoading && activities.data?.length === 0 && (
        <p style={muted}>No activity yet.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {(activities.data ?? []).map((a) => (
          <li key={a.id} style={{ borderLeft: "2px solid #333", paddingLeft: "0.75rem" }}>
            <div style={muted}>
              {authorName(a)} · {new Date(a.occurredAt).toLocaleString()}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
