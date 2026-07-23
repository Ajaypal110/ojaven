"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";
import { ActivityTimeline } from "./ActivityTimeline";

type Outputs = inferRouterOutputs<AppRouter>;
type ContentItem = Outputs["content"]["list"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.85rem" } as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;

const STATUS_COLOR: Record<string, string> = {
  draft: "#888",
  in_review: "#3B82F6",
  approved: "#3FB950",
  rejected: "#D97706",
  published: "#8B5CF6",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
};
const TYPE_SUGGESTIONS = ["blog", "ad", "social"];

export function ContentSection({ clientId }: { clientId: string }) {
  const team = trpc.team.list.useQuery();
  const list = trpc.content.list.useQuery({ clientId });
  const [creating, setCreating] = useState(false);

  // The manager tier's first outing: manager+ can review; operators create,
  // edit, submit, publish. Server enforces via assertReviewRole regardless.
  const role = team.data?.callerRole;
  const canReview = role === "owner" || role === "admin" || role === "manager";

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Content</h2>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            New content
          </button>
        )}
      </div>

      {creating && <ContentForm clientId={clientId} onDone={() => setCreating(false)} />}

      {list.isLoading && <p style={muted}>Loading…</p>}
      {!list.isLoading && list.data?.length === 0 && !creating && <p style={muted}>No content yet.</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(list.data ?? []).map((item) => (
          <ContentRow key={item.id} item={item} canReview={canReview} />
        ))}
      </ul>
    </section>
  );
}

function ContentRow({ item, canReview }: { item: ContentItem; canReview: boolean }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const refresh = () => utils.content.invalidate();

  const submit = trpc.content.submit.useMutation({ onSuccess: refresh });
  const review = trpc.content.review.useMutation({
    onSuccess: () => {
      refresh();
      setRejectNote("");
    },
  });
  const publish = trpc.content.publish.useMutation({ onSuccess: refresh });
  const del = trpc.content.delete.useMutation({ onSuccess: refresh });

  const editable = item.status === "draft" || item.status === "rejected";

  if (editing) {
    return (
      <li>
        <ContentForm
          clientId={item.clientId}
          onDone={() => setEditing(false)}
          existing={{ id: item.id, title: item.title, body: item.body ?? "", contentType: item.contentType }}
        />
      </li>
    );
  }

  return (
    <li style={{ ...card, borderColor: item.status === "rejected" ? "#D97706" : "#333" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
        <strong>{item.title}</strong>
        <span style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
          <span style={muted}>{item.contentType}</span>
          <span style={{ color: STATUS_COLOR[item.status], fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase" }}>
            {STATUS_LABEL[item.status]}
          </span>
        </span>
      </div>

      {/* The latest verdict's note — most important on rejection. */}
      {item.reviewNote && (
        <div
          style={{
            marginTop: "0.4rem",
            padding: "0.4rem 0.6rem",
            borderLeft: `3px solid ${item.status === "rejected" ? "#D97706" : "#3FB950"}`,
            background: "#1a1a1a",
            fontSize: "0.875rem",
          }}
        >
          Reviewer: {item.reviewNote}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
        {editable && (
          <>
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" disabled={submit.isPending} onClick={() => submit.mutate({ id: item.id })}>
              {submit.isPending ? "Submitting…" : item.status === "rejected" ? "Resubmit" : "Submit for review"}
            </button>
          </>
        )}

        {item.status === "in_review" && canReview && (
          <>
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate({ id: item.id, decision: "approve", note: rejectNote || undefined })}
            >
              Approve
            </button>
            <input
              placeholder="Why? (encouraged on reject)"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              style={{ width: "14rem" }}
            />
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate({ id: item.id, decision: "reject", note: rejectNote || undefined })}
            >
              Reject
            </button>
          </>
        )}
        {item.status === "in_review" && !canReview && <span style={muted}>Awaiting review</span>}

        {item.status === "approved" && (
          <button type="button" disabled={publish.isPending} onClick={() => publish.mutate({ id: item.id })}>
            {publish.isPending ? "Publishing…" : "Publish"}
          </button>
        )}

        <button type="button" onClick={() => setExpanded((s) => !s)}>
          {expanded ? "Hide" : "View & discussion"}
        </button>

        {confirmDelete ? (
          <>
            <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: item.id })}>
              {del.isPending ? "Deleting…" : "Confirm delete"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>
      {(submit.error || review.error || publish.error || del.error) && (
        <p style={warn}>{(submit.error ?? review.error ?? publish.error ?? del.error)?.message}</p>
      )}

      {expanded && (
        <div style={{ marginTop: "0.75rem", borderTop: "1px dashed #333", paddingTop: "0.5rem" }}>
          {item.body && <div style={{ whiteSpace: "pre-wrap", marginBottom: "0.5rem" }}>{item.body}</div>}
          {/* The A4 timeline on a content_item — the assertEntityLive extension
              in practice: the review conversation lives here, the reviewNote
              above stays the canonical verdict. */}
          <ActivityTimeline entityType="content_item" entityId={item.id} />
        </div>
      )}
    </li>
  );
}

function ContentForm({
  clientId,
  onDone,
  existing,
}: {
  clientId: string;
  onDone: () => void;
  existing?: { id: string; title: string; body: string; contentType: string };
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [contentType, setContentType] = useState(existing?.contentType ?? "blog");
  const [body, setBody] = useState(existing?.body ?? "");

  const done = () => {
    utils.content.invalidate();
    onDone();
  };
  const create = trpc.content.create.useMutation({ onSuccess: done });
  const update = trpc.content.update.useMutation({ onSuccess: done });
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const submitForm = () => {
    if (existing) update.mutate({ id: existing.id, title, contentType, body });
    else create.mutate({ clientId, title, contentType, body });
  };

  return (
    <div style={{ ...card, marginTop: "1rem", display: "grid", gap: "0.6rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: "10rem" }} />
        <input
          list="content-type-suggestions"
          placeholder="type (blog / ad / social / …)"
          value={contentType}
          onChange={(e) => setContentType(e.target.value)}
          style={{ width: "12rem" }}
        />
        <datalist id="content-type-suggestions">
          {TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <textarea
        placeholder="Content body…"
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ resize: "vertical" }}
      />
      {error && <p style={warn}>{error.message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" disabled={pending || title.trim() === "" || contentType.trim() === ""} onClick={submitForm}>
          {pending ? "Saving…" : existing ? "Save" : "Create draft"}
        </button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
