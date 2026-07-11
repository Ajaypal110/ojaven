# ojaven.com — coming soon page

Stealth landing page for Ojaven, built with Next.js 14 (App Router), TypeScript, and Tailwind CSS.

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Deployment (Vercel)

1. Push this repo to GitHub.
2. In Vercel, import the GitHub repo as a new project (framework preset: Next.js, auto-detected).
3. In **Project Settings → Domains**, add the custom domain `ojaven.com` (and `www.ojaven.com` if desired) and follow Vercel's DNS instructions.
4. Deploy. Add `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_SECRET` in Project Settings → Environment Variables to enable waitlist storage (see "Waitlist Setup" below) — the site works without them, submissions just won't be persisted anywhere.

## Waitlist Setup

Submissions hit `app/api/waitlist/route.ts`, which validates the email, applies basic in-memory rate limiting (5 requests/minute/IP), and forwards valid entries to a Google Sheet via a Google Apps Script Web App acting as a lightweight webhook proxy. No service account keys or OAuth needed — it works with any Google account.

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

Add these to `.env.local` (for local dev) and to the Vercel project's Environment Variables (for production):

```
GOOGLE_SHEETS_WEBHOOK_URL=<the web app URL from step 3>
GOOGLE_SHEETS_SECRET=<the same random string from step 2>
```

See `.env.example` for the variable names. If these env vars are missing, the API route logs an error and still returns success to the visitor (so the form never shows an infra failure to a user) — check the deployment logs to catch a misconfiguration.

## Assets to add later

- `public/favicon.ico` — the "o." mark.
- `public/apple-touch-icon.png` — referenced in `app/layout.tsx` metadata.
- `public/og-image.png` — 1200×630 Open Graph image (already referenced in `app/layout.tsx` metadata).

## Notes

- Everything except the waitlist form (`components/WaitlistForm.tsx`) is a Server Component.
- Social icons are inline SVG (no icon library) in `components/SocialLinks.tsx`.
- Respects `prefers-reduced-motion` (see `app/globals.css`).
