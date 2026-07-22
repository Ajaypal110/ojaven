"use client";

import { trpc } from "@/lib/trpc/client";
import { CreateTaskForm, TaskList } from "../../tasks/taskShared";

/** Tasks linked to this client. Create pre-links to the client entity. */
export function TasksSection({ clientId }: { clientId: string }) {
  const team = trpc.team.list.useQuery();
  const tasks = trpc.tasks.list.useQuery({ entityType: "client", entityId: clientId });
  const members = team.data?.members ?? [];

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <h2 style={{ margin: 0 }}>Tasks</h2>
      <CreateTaskForm entityType="client" entityId={clientId} members={members} />
      {tasks.isLoading && <p style={{ color: "#888" }}>Loading…</p>}
      {tasks.error && <p style={{ color: "#D97706" }}>{tasks.error.message}</p>}
      {tasks.data && <TaskList tasks={tasks.data} members={members} />}
    </section>
  );
}
