# Ojaven

The all-in-one platform for marketing agencies. Kill the SaaS tax — one place, one price.

This is a pnpm monorepo. The `ojaven.com` landing page is live today; the product itself is being built out incrementally behind auth, in the same repo, without touching the live site.

## Structure

```
/apps
  /web          Next.js 14 App Router app — landing page today, product later
    /app
      /(marketing)   the public ojaven.com site (untouched by product work)
      /(auth)        login / signup — added in a later step
      /(product)     authenticated app — added in a later step
/packages
  /db           Drizzle schema + Neon client (stub — filled in next)
  /server       tRPC routers + business logic, shared with the future mobile app (stub)
  /shared       cross-cutting types, Zod schemas, constants, logger (stub)
  /ui           shadcn/ui components, web-only (stub)
  /emails       React Email templates (stub)
```

`packages/*` are source-only workspace packages (no build step) — `apps/web`'s `next.config.js` transpiles them directly via `transpilePackages`.

## Local development

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000). `pnpm dev` / `pnpm build` / `pnpm start` / `pnpm lint` at the repo root delegate to `apps/web` — to target it explicitly, use `pnpm --filter @ojaven/web <script>`.

Env vars live in `apps/web/.env.local` (Next.js only loads `.env*` files from its own app directory, not the workspace root) — see `apps/web/.env.example` for the current variable names.

## Deployment (Vercel)

Vercel's Project Settings → Root Directory is still `.` (repo root) — it has **not** been changed to `apps/web` yet, so the live site keeps deploying from `main` as before. That setting only gets updated once this branch is reviewed and merged; see the PR/branch notes for the current status.

Once updated, deploying is otherwise unchanged: push to GitHub, Vercel builds `apps/web`, add `GOOGLE_SHEETS_WEBHOOK_URL` / `GOOGLE_SHEETS_SECRET` in Project Settings → Environment Variables (site works without them, waitlist submissions just won't persist).

## Waitlist Setup

Submissions hit `apps/web/app/api/waitlist/route.ts`, which validates the email, applies basic in-memory rate limiting (5 requests/minute/IP), and forwards valid entries to a Google Sheet via a Google Apps Script Web App acting as a lightweight webhook proxy. No service account keys or OAuth needed — it works with any Google account.

### 1. Create the sheet

Create a new Google Sheet named "Ojaven Waitlist" with these columns:

| A | B | C | D |
|---|---|---|---|
| Timestamp | Email | Source | User Agent |

### 2. Add the Apps Script

Open **Extensions → Apps Script** in the sheet and replace the default code with:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  // Simple secret check - reject if key is wrong
  if (data.secret !== "REPLACE_WITH_RANDOM_SECRET_STRING") {
    return ContentService.createTextOutput(JSON.stringify({ error: "unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([
    new Date(),
    data.email,
    data.source || "landing_page",
    data.userAgent || ""
  ]);

  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Replace `REPLACE_WITH_RANDOM_SECRET_STRING` with a random string of your own (e.g. generate one with `openssl rand -hex 32`) — this is the value you'll also set as `GOOGLE_SHEETS_SECRET` below.

### 3. Deploy as a Web App

**Deploy → New deployment → Type: Web App**
- Execute as: **Me**
- Who has access: **Anyone**

Copy the resulting Web App URL.

### 4. Set environment variables

Add these to `apps/web/.env.local` (for local dev) and to the Vercel project's Environment Variables (for production):

```
GOOGLE_SHEETS_WEBHOOK_URL=<the web app URL from step 3>
GOOGLE_SHEETS_SECRET=<the same random string from step 2>
```

See `apps/web/.env.example` for the variable names. If these env vars are missing, the API route logs an error and still returns success to the visitor (so the form never shows an infra failure to a user) — check the deployment logs to catch a misconfiguration.

## Assets to add later

- `apps/web/public/favicon.ico` — the "o." mark.
- `apps/web/public/apple-touch-icon.png` — referenced in `apps/web/app/layout.tsx` metadata.
- `apps/web/public/og-image.png` — 1200×630 Open Graph image (already referenced in `apps/web/app/layout.tsx` metadata).

## Notes

- Everything in `(marketing)` except the waitlist form (`components/marketing/WaitlistForm.tsx`) is a Server Component.
- Social icons are inline SVG (no icon library) in `components/marketing/SocialLinks.tsx`.
- Respects `prefers-reduced-motion` (see `app/globals.css`).
- `packages/db`, `packages/server`, `packages/shared`, `packages/ui`, `packages/emails` are currently empty stubs — Neon + Drizzle schema, tRPC, and Clerk auth get wired in over the next steps of the `feat/monorepo-refactor` branch.
