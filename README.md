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
4. Deploy. No environment variables are required for the current setup.

## Waitlist storage

Submissions currently hit `app/api/waitlist/route.ts`, which validates the email and logs it to the console (`console.log`). This is a placeholder — see the `TODO` comment in that file.

To wire up real storage before launch, replace the `TODO` block with one of:

- **Vercel KV** — `npm i @vercel/kv`, then `kv.lpush('waitlist', email)` (requires a KV store + env vars from the Vercel dashboard).
- **Supabase** — insert into a `waitlist` table via `@supabase/supabase-js` (requires `SUPABASE_URL` / `SUPABASE_ANON_KEY`).
- **ConvertKit / other ESP API** — POST the email to your provider's subscribe endpoint (requires an API key).

## Assets to add later

- `public/favicon.ico` — the "o." mark.
- `public/og-image.png` — 1200×630 Open Graph image (already referenced in `app/layout.tsx` metadata).

## Notes

- Everything except the waitlist form (`components/WaitlistForm.tsx`) is a Server Component.
- Social icons are inline SVG (no icon library) in `components/SocialLinks.tsx`.
- Respects `prefers-reduced-motion` (see `app/globals.css`).
