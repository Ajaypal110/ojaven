import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/clients(.*)",
  "/team(.*)",
  "/pipeline(.*)",
  "/tasks(.*)",
  "/notifications(.*)",
  "/settings(.*)",
]);
const isSignUpRoute = createRouteMatcher(["/sign-up(.*)"]);

/**
 * Stealth-period guard, independent of Clerk's own dashboard "Restricted
 * mode" toggle — defense-in-depth so a dashboard misconfiguration (or that
 * toggle turning out to need a paid plan) doesn't silently reopen public
 * sign-up. Default false (fail closed): only the literal string "true"
 * enables it. Flip via ALLOW_PUBLIC_SIGNUP when the product actually
 * launches — no code change needed at that point, just the env var.
 */
const allowPublicSignup = process.env.ALLOW_PUBLIC_SIGNUP === "true";

export default clerkMiddleware(async (auth, req) => {
  if (isSignUpRoute(req) && !allowPublicSignup) {
    // A rewrite to an unmatched path (not a redirect, not a hand-built
    // Response) so Next.js's own not-found flow renders — real 404 status,
    // respects a custom not-found.tsx if one's ever added. The route
    // should look like it doesn't exist, not like it exists-but-blocked.
    const url = req.nextUrl.clone();
    url.pathname = "/__stealth_404__";
    return NextResponse.rewrite(url);
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, static files, the bare marketing homepage,
    // and marketing's own public routes (robots/sitemap/waitlist/assets)
    // — none of those should pay Clerk's session-resolution cost. In dev
    // this is a real multi-hop handshake redirect, not just a
    // bundle-size concern, and for api/webhooks specifically it's also a
    // correctness issue: Clerk's own server-to-server webhook calls have
    // no browser/cookies to complete that handshake with.
    "/((?!_next|api/waitlist|api/webhooks|robots\\.txt|sitemap\\.xml|favicon\\.ico|apple-touch-icon\\.png|og-image\\.png|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|$).*)",
    // tRPC needs clerkMiddleware to have run so context.ts's auth() call
    // works, even for publicProcedure — it just isn't a "protected" route.
    "/api/trpc(.*)",
    // Clerk's own frontend API proxy routes
    "/__clerk/(.*)",
  ],
};
