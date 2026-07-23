import { TRPCError } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@ojaven/shared";
import { middleware } from "../trpc";

const hasUpstashConfig = Boolean(
  process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN
);

// Boot-state line (decided 2026-07-23): ambiguous activation state is exactly
// how you end up unprotected without knowing.
logger.info(
  hasUpstashConfig
    ? "rate limiting ACTIVE (Upstash)"
    : "rate limiting INACTIVE — no Upstash config"
);

/** Tunables in one block — tuning is a one-line diff. All sliding 1-minute windows, per path. */
const LIMITS = {
  publicPerPath: 30, // a legit client's whole proposal flow is <10 requests
  publicAggregate: 100, // pooled across ALL public paths per IP — patches the spread-load hole
  authedMutation: 60,
  authedQuery: 120, // headroom for refetch storms (refocus / invalidate-all)
} as const;
const TIMEOUT_MS = 1000;

const redis = hasUpstashConfig
  ? new Redis({
      url: process.env.UPSTASH_REDIS_URL as string,
      token: process.env.UPSTASH_REDIS_TOKEN as string,
    })
  : null;

const makeLimiter = (tokens: number, prefix: string) =>
  new Ratelimit({
    redis: redis as Redis,
    limiter: Ratelimit.slidingWindow(tokens, "1 m"),
    prefix,
  });

const limiters = redis
  ? {
      publicPerPath: makeLimiter(LIMITS.publicPerPath, "rl:pub"),
      publicAggregate: makeLimiter(LIMITS.publicAggregate, "rl:pubagg"),
      authedMutation: makeLimiter(LIMITS.authedMutation, "rl:mut"),
      authedQuery: makeLimiter(LIMITS.authedQuery, "rl:qry"),
    }
  : null;

// ── Fail-open canary (per server instance; resets on boot — a canary you can
// check, not a metric. Real alerting is Sentry's job at B6.) ─────────────────
let failuresSinceBoot = 0;
let lastFailureAt: string | null = null;

export function getLimiterStatus() {
  return { active: hasUpstashConfig, failuresSinceBoot, lastFailureAt };
}

function recordFailure(err: unknown, identifier: string, path: string) {
  failuresSinceBoot += 1;
  lastFailureAt = new Date().toISOString();
  // NOISY by decision (2026-07-23): one error per skipped check, no dedupe, no
  // sampling. Silently unprotected is how you don't notice for a week.
  logger.error({ err, identifier, path }, "rate limiter unreachable — FAILING OPEN");
}

/**
 * FAIL-OPEN (decided 2026-07-23): rate limiting is protective, not
 * correctness. Fail-closed = total product outage whenever Upstash blinks;
 * fail-open = a bounded abuse window (public surfaces are protected by 256-bit
 * token entropy — the limiter only bounds spam). The timeout is our OWN
 * Promise.race, not the SDK's `timeout` option, deliberately: the SDK resolves
 * a timed-out check as success WITHOUT surfacing it, which would violate the
 * noisy requirement. Every skipped check goes through recordFailure.
 */
async function checkLimit(
  limiter: Ratelimit,
  key: string,
  identifier: string,
  path: string
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      limiter.limit(key),
      new Promise<"__timeout__">((resolve) => {
        timer = setTimeout(() => resolve("__timeout__"), TIMEOUT_MS);
      }),
    ]);
    if (result === "__timeout__") {
      recordFailure(new Error(`limiter timed out after ${TIMEOUT_MS}ms`), identifier, path);
      return true;
    }
    return result.success;
  } catch (err) {
    recordFailure(err, identifier, path);
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Rate-limit bucket key. Authenticated: per-user. Unauthenticated (public
 * endpoints): per-IP, so one abuser can't exhaust a shared "anonymous" bucket
 * and starve real clients. Every future public surface (portal, booking, review
 * links) inherits this keying. (Local dev has no x-forwarded-for, so anonymous
 * requests share the "anonymous" bucket there — per-IP proves out behind a
 * proxy, e.g. Vercel.)
 */
export function rateLimitIdentifier(ctx: { userId?: string | null; ip?: string | null }): string {
  return ctx.userId ?? (ctx.ip ? `ip:${ctx.ip}` : "anonymous");
}

const tooMany = () =>
  new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });

/**
 * Tiered limits (design-reviewed 2026-07-23), keyed PER PATH deliberately —
 * a burst of dashboard queries (one client-detail page fires ~15 distinct
 * queries; a window refocus refetches them all at once) must never starve an
 * unrelated mutation. Do not "simplify" to a single global bucket: the weak
 * aggregate that per-path keying leaves open only matters on the PUBLIC
 * surface, and the pooled publicAggregate check below is what patches it.
 */
export const rateLimited = middleware(async ({ ctx, next, path, type }) => {
  if (!limiters) {
    return next();
  }

  const identifier = rateLimitIdentifier(ctx);

  if (ctx.userId) {
    const limiter = type === "mutation" ? limiters.authedMutation : limiters.authedQuery;
    if (!(await checkLimit(limiter, `${identifier}:${path}`, identifier, path))) {
      throw tooMany();
    }
  } else {
    if (!(await checkLimit(limiters.publicPerPath, `${identifier}:${path}`, identifier, path))) {
      throw tooMany();
    }
    // Aggregate pool across all public paths for this IP.
    if (!(await checkLimit(limiters.publicAggregate, identifier, identifier, path))) {
      throw tooMany();
    }
  }

  return next();
});
