"use client";

import { trpc } from "@/lib/trpc/client";

/**
 * Step 5 verification page — proves the tRPC round trip (client → Next.js
 * API route → tRPC router → response) and that type inference works.
 * Not auth-gated yet; that's Step 6.
 */
export default function DashboardPage() {
  const ping = trpc.health.ping.useQuery();

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>tRPC round-trip check</h1>
      {ping.isLoading && <p>Loading…</p>}
      {ping.error && <p>Error: {ping.error.message}</p>}
      {ping.data && (
        <pre>
          status: {ping.data.status}
          {"\n"}
          timestamp: {ping.data.timestamp}
        </pre>
      )}
    </div>
  );
}
