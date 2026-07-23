import { TRPCError } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { middleware } from "../trpc";

const hasUpstashConfig = Boolean(
  process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN
);

// TODO: once UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN are set (in
// apps/web/.env.local + Vercel), this activates automatically — no other
// code changes needed. Until then it's a no-op passthrough.
const ratelimit = hasUpstashConfig
  ? new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_URL as string,
        token: process.env.UPSTASH_REDIS_TOKEN as string,
      }),
      limiter: Ratelimit.slidingWindow(60, "1 m"),
    })
  : null;

/**
 * Rate-limit bucket key. Authenticated: per-user. Unauthenticated (public
 * endpoints): per-IP, so one abuser can't exhaust a shared "anonymous" bucket
 * and starve real clients. Every future public surface (portal, booking, review
 * links) inherits this keying.
 */
export function rateLimitIdentifier(ctx: { userId?: string | null; ip?: string | null }): string {
  return ctx.userId ?? (ctx.ip ? `ip:${ctx.ip}` : "anonymous");
}

export const rateLimited = middleware(async ({ ctx, next, path }) => {
  if (!ratelimit) {
    return next();
  }

  const identifier = rateLimitIdentifier(ctx);
  const { success } = await ratelimit.limit(`${identifier}:${path}`);

  if (!success) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
  }

  return next();
});
