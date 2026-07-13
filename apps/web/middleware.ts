import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/onboarding(.*)"]);

export default clerkMiddleware(async (auth, req) => {
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
