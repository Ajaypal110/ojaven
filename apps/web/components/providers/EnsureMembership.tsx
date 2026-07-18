"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpc } from "@/lib/trpc/client";

/**
 * The general-purpose trigger for team.ensureMembership: fires whenever
 * Clerk's active orgId changes (including its first resolution), covering
 * every path onboarding's own call doesn't — invited into a second agency,
 * switching orgs, or any flow that never passes through /onboarding. The
 * mutation is idempotent, so redundant firing (this + onboarding + the
 * webhook all landing) is harmless by design.
 */
export default function EnsureMembership() {
  const { orgId, isLoaded } = useAuth();
  const { mutate } = trpc.team.ensureMembership.useMutation();
  const lastOrgId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !orgId || orgId === lastOrgId.current) return;
    lastOrgId.current = orgId;
    mutate();
  }, [isLoaded, orgId, mutate]);

  return null;
}
