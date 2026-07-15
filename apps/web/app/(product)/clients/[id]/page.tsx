"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const client = trpc.clients.byId.useQuery({ id: params.id });

  return (
    <div style={{ padding: "2rem", maxWidth: "480px" }}>
      <Link href="/clients">&larr; Clients</Link>

      {client.isLoading && <p>Loading…</p>}
      {client.error && <p>Error: {client.error.message}</p>}

      {client.data && (
        <>
          <h1 style={{ marginTop: "1rem" }}>{client.data.name}</h1>
          <dl style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
            <div>
              <dt style={{ color: "#888", fontSize: "0.875rem" }}>Status</dt>
              <dd>{client.data.status}</dd>
            </div>
            {client.data.website && (
              <div>
                <dt style={{ color: "#888", fontSize: "0.875rem" }}>Website</dt>
                <dd>{client.data.website}</dd>
              </div>
            )}
            {client.data.industry && (
              <div>
                <dt style={{ color: "#888", fontSize: "0.875rem" }}>Industry</dt>
                <dd>{client.data.industry}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}
