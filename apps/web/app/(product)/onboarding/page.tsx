"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

/**
 * Polls agency.current, which throws AgencySyncPendingError (surfaced as
 * error.data.reason === "AGENCY_SYNC_PENDING") until the Clerk webhook has
 * synced the just-created organization into our own agencies table. See
 * packages/server's tenant middleware + errors.ts.
 */
export default function OnboardingPage() {
  const router = useRouter();

  const agency = trpc.agency.current.useQuery(undefined, {
    retry: (failureCount, err) => {
      return err.data?.reason === "AGENCY_SYNC_PENDING" && failureCount < MAX_RETRIES;
    },
    retryDelay: RETRY_DELAY_MS,
  });

  useEffect(() => {
    if (agency.data) {
      router.push("/dashboard");
    }
  }, [agency.data, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      {agency.isError ? (
        <>
          <p className="mb-2 text-base text-foreground">
            {agency.error.data?.reason === "AGENCY_SYNC_PENDING"
              ? "Your workspace is taking longer than usual to set up."
              : "Something went wrong setting up your workspace."}
          </p>
          <p className="mb-6 text-sm text-muted">{agency.error.message}</p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => agency.refetch()}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
            <a
              href="mailto:hello@ojaven.com"
              className="text-sm text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Contact support
            </a>
          </div>
        </>
      ) : (
        <p className="text-base text-muted">Setting up your workspace…</p>
      )}
    </div>
  );
}
