"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

const muted = { color: "#888", fontSize: "0.85rem" } as const;

export default function NotificationsPage() {
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery({});
  const unread = trpc.notifications.unreadCount.useQuery();

  const refresh = () => utils.notifications.invalidate();
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: refresh });

  return (
    <div style={{ padding: "2rem", maxWidth: "640px" }}>
      <Link href="/dashboard">&larr; Dashboard</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "1rem 0" }}>
        <h1 style={{ margin: 0 }}>
          Notifications
          {(unread.data?.count ?? 0) > 0 && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.9rem", color: "#F5C451" }}>
              {unread.data!.count} unread
            </span>
          )}
        </h1>
        {(unread.data?.count ?? 0) > 0 && (
          <button type="button" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            Mark all read
          </button>
        )}
      </div>

      {list.isLoading && <p style={muted}>Loading…</p>}
      {!list.isLoading && list.data?.length === 0 && <p style={muted}>Nothing yet.</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
        {(list.data ?? []).map((n) => {
          const isUnread = n.readAt == null;
          return (
            <li
              key={n.id}
              onClick={() => isUnread && markRead.mutate({ id: n.id })}
              style={{
                border: "1px solid #333",
                borderLeft: isUnread ? "3px solid #F5C451" : "3px solid #333",
                borderRadius: 6,
                padding: "0.75rem",
                cursor: isUnread ? "pointer" : "default",
                opacity: isUnread ? 1 : 0.7,
              }}
              title={isUnread ? "Click to mark read" : undefined}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <strong style={{ fontWeight: isUnread ? 700 : 500 }}>{n.title}</strong>
                <span style={muted}>{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              {n.body && <div style={{ marginTop: "0.25rem", fontSize: "0.9rem" }}>{n.body}</div>}
              <div style={{ ...muted, marginTop: "0.25rem" }}>{n.type}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
