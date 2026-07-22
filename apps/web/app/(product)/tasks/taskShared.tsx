"use client";

import { useState } from "react";
import {
  taskPriorityValues,
  taskStatusValues,
  type EntityType,
  type TaskStatus,
} from "@ojaven/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type Outputs = inferRouterOutputs<AppRouter>;
export type Task = Outputs["tasks"]["list"][number];
export type Member = Outputs["team"]["list"]["members"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.85rem" } as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function memberName(m: Member | undefined): string {
  if (!m) return "Unknown";
  const full = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim();
  return full || m.email;
}

/** Create form — pre-links to an entity when entityType/entityId are given,
 *  otherwise creates a standalone task. */
export function CreateTaskForm({
  entityType,
  entityId,
  members,
}: {
  entityType?: EntityType;
  entityId?: string;
  members: Member[];
}) {
  const utils = trpc.useUtils();
  const create = trpc.tasks.create.useMutation({
    onSuccess: async () => {
      await utils.tasks.list.invalidate();
      setTitle("");
      setAssigneeId("");
      setPriority("medium");
      setDueAt("");
    },
  });

  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<(typeof taskPriorityValues)[number]>("medium");
  const [dueAt, setDueAt] = useState("");

  const submit = () =>
    create.mutate({
      title,
      priority,
      assigneeId: assigneeId || undefined,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      ...(entityType && entityId ? { entityType, entityId } : {}),
    });

  return (
    <div style={{ ...card, marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <input placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {memberName(m)}
          </option>
        ))}
      </select>
      <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
        {taskPriorityValues.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} title="Due date" />
      <button type="button" disabled={create.isPending || title.trim() === ""} onClick={submit}>
        {create.isPending ? "Adding…" : "Add task"}
      </button>
      {create.error && <span style={warn}>{create.error.message}</span>}
    </div>
  );
}

export function TaskList({
  tasks,
  members,
  showEntity = false,
}: {
  tasks: Task[];
  members: Member[];
  showEntity?: boolean;
}) {
  // Completed/cancelled sink to the bottom — so marking a task done visibly
  // MOVES it (and un-marking floats it back). Sort is stable, preserving the
  // server's due-date order within each group.
  const rank = (s: string) => (s === "done" || s === "cancelled" ? 1 : 0);
  const sorted = [...tasks].sort((a, b) => rank(a.status) - rank(b.status));

  if (tasks.length === 0) return <p style={muted}>No tasks.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
      {sorted.map((t) => (
        <TaskItem key={t.id} task={t} members={members} showEntity={showEntity} />
      ))}
    </ul>
  );
}

function TaskItem({
  task,
  members,
  showEntity,
}: {
  task: Task;
  members: Member[];
  showEntity: boolean;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.tasks.list.invalidate();
  const setStatus = trpc.tasks.setStatus.useMutation({ onSuccess: invalidate });
  const del = trpc.tasks.delete.useMutation({ onSuccess: invalidate });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const assignee = members.find((m) => m.userId === task.assigneeId);
  const complete = task.status === "done" || task.status === "cancelled";

  return (
    <li style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
        <strong style={{ textDecoration: complete ? "line-through" : "none", color: complete ? "#888" : undefined }}>
          {task.title}
        </strong>
        <span style={muted}>{task.priority}</span>
      </div>

      <div style={{ ...muted, marginTop: "0.25rem" }}>
        {assignee ? memberName(assignee) : "Unassigned"}
        {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ""}
        {showEntity ? (task.entityType ? ` · on ${task.entityType.replace(/_/g, " ")}` : " · standalone") : ""}
        {task.status === "done" && task.completedAt
          ? ` · completed ${new Date(task.completedAt).toLocaleString()}`
          : ""}
      </div>

      {/* Status as BUTTONS (not a select) so clicking the current status
          re-fires setStatus — lets you re-mark "done" and watch completedAt
          stay put (preserve-original). */}
      <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        {taskStatusValues.map((s) => {
          const active = task.status === s;
          return (
            <button
              key={s}
              type="button"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: task.id, status: s })}
              style={{
                fontSize: "0.8rem",
                padding: "0.15rem 0.5rem",
                borderRadius: 4,
                border: active ? "1px solid #F5C451" : "1px solid #333",
                background: active ? "#F5C451" : "transparent",
                color: active ? "#0A0A0A" : "#ccc",
                fontWeight: active ? 700 : 400,
              }}
            >
              {STATUS_LABEL[s]}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        {confirmDelete ? (
          <>
            <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: task.id })}>
              {del.isPending ? "Deleting…" : "Confirm"}
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
      </div>
      {(setStatus.error || del.error) && (
        <p style={warn}>{(setStatus.error ?? del.error)?.message}</p>
      )}
    </li>
  );
}
