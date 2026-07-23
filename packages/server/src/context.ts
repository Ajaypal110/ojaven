import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@clerk/nextjs/server";
import { db } from "@ojaven/db";
import { logger } from "@ojaven/shared";

/**
 * Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). Used
 * to rate-limit UNAUTHENTICATED callers per-origin — without it every anonymous
 * request shares one bucket, so one abuser starves every legitimate client
 * viewing a public proposal. Null in local dev / when no header is present.
 */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}

/**
 * Resolves the Clerk session for this request. Wrapped in try/catch
 * deliberately: Clerk's auth() throws if clerkMiddleware() didn't run for
 * this request (e.g. apps/web hasn't wired up Clerk middleware yet, or a
 * route genuinely isn't behind it). Any resolution failure is treated
 * uniformly as "no session" — procedures decide what to do about that,
 * this function's job is just to never crash context creation.
 */
async function resolveSession(): Promise<{
  userId: string | null;
  clerkOrgId: string | null;
  clerkOrgRole: string | null;
}> {
  try {
    const session = await auth();
    return {
      userId: session.userId,
      clerkOrgId: session.orgId ?? null,
      clerkOrgRole: session.orgRole ?? null,
    };
  } catch {
    return { userId: null, clerkOrgId: null, clerkOrgRole: null };
  }
}

export async function createContext(opts?: FetchCreateContextFnOptions) {
  const session = await resolveSession();

  return {
    db,
    logger,
    userId: session.userId,
    clerkOrgId: session.clerkOrgId,
    clerkOrgRole: session.clerkOrgRole,
    ip: opts ? clientIp(opts.req) : null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
