"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

export default function ClientsPage() {
  const clients = trpc.clients.list.useQuery();

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Clients</h1>
        <Link href="/clients/new">+ New client</Link>
      </div>

      {clients.isLoading && <p>Loading…</p>}
      {clients.error && <p>Error: {clients.error.message}</p>}

      {clients.data && clients.data.length === 0 && <p>No clients yet.</p>}

      {clients.data && clients.data.length > 0 && (
        <ul style={{ marginTop: "1rem", listStyle: "none", padding: 0 }}>
          {clients.data.map((client) => (
            <li
              key={client.id}
              style={{ padding: "0.75rem 0", borderBottom: "1px solid #333" }}
            >
              <Link href={`/clients/${client.id}`}>{client.name}</Link>
              <span style={{ marginLeft: "0.75rem", color: "#888", fontSize: "0.875rem" }}>
                {client.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
