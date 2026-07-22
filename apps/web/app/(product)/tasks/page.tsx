"use client";

import { useState } from "react";
import Link from "next/link";
import { taskStatusValues, type TaskStatus } from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";
import { CreateTaskForm, TaskList } from "./taskShared";

export default function TasksPage() {
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState<"" | TaskStatus>("");

  const team = trpc.team.list.useQuery();
  const tasks = trpc.tasks.list.useQuery({
    mine: mine || undefined,
    status: status || undefined,
  });

  const members = team.data?.members ?? [];

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <Link href="/dashboard">&larr; Dashboard</Link>
      <h1 style={{ margin: "1rem 0" }}>Tasks</h1>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Only mine
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | TaskStatus)}>
            <option value="">All</option>
            {taskStatusValues.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Standalone create (no entity link) — proves the optional-link half. */}
      <CreateTaskForm members={members} />

      {tasks.isLoading && <p style={{ color: "#888" }}>Loading…</p>}
      {tasks.error && <p style={{ color: "#D97706" }}>{tasks.error.message}</p>}
      {tasks.data && <TaskList tasks={tasks.data} members={members} showEntity />}
    </div>
  );
}
