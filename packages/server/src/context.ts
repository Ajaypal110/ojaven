import { auth } from "@clerk/nextjs/server";
import { db } from "@ojaven/db";
import { logger } from "@ojaven/shared";

/**
 * Resolves the Clerk session for this request. Wrapped in try/catch
 * deliberately: Clerk's auth() throws if clerkMiddleware() didn't run for
 * this request (e.g. apps/web hasn't wired up Clerk middleware yet, or a
 * route genuinely isn't behind it). Any resolution failure is treated
 * uniformly as "no session" — procedures decide what to do about that,
 * this function's job is just to never crash context creation.
 */
async function resolveSession(): Promise<{ userId: string | null; clerkOrgId: string | null }> {
  try {
    const session = await auth();
    return { userId: session.userId, clerkOrgId: session.orgId ?? null };
  } catch {
    return { userId: null, clerkOrgId: null };
  }
}

export async function createContext() {
  const session = await resolveSession();

  return {
    db,
    logger,
    userId: session.userId,
    clerkOrgId: session.clerkOrgId,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
