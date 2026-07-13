# @ojaven/db

Drizzle ORM schema + client for Neon Postgres. Consumed by `@ojaven/server` (and eventually the mobile app) — this package owns the schema, nothing else should define tables.

## Workflow

Schema changes go straight to Neon via `drizzle-kit push` — no versioned migration files. This is a deliberate early-stage choice for iteration speed; revisit if/when a second environment (staging) needs to stay in sync with prod, or the schema stabilizes enough that migration history becomes worth the overhead.

```bash
pnpm --filter @ojaven/db db:push       # sync schema/ to Neon
pnpm --filter @ojaven/db db:studio     # browse data in Drizzle Studio
pnpm --filter @ojaven/db typecheck     # tsc --noEmit
```

Env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) live in `apps/web/.env.local` — `drizzle.config.ts` loads that file explicitly (via `dotenv`) since `packages/db` has no `.env` of its own. Keep it that way; don't duplicate env files.

## Two DB clients, on purpose

**`src/client.ts` — `neon-http` driver (default, use this).** Single HTTP round-trip per query, Edge-runtime compatible. This is what every tRPC procedure should import (`import { db } from "@ojaven/db"`).

The tradeoff: **no interactive transactions.** `neon-http` can't do `BEGIN` / multiple statements / `COMMIT` across round trips. For an atomic multi-statement write, use Drizzle's `db.batch([...])` — it bundles several queries into one HTTP call and Neon runs them atomically, but each statement is independent (no reading your own writes mid-batch, no conditional branching).

```ts
import { db } from "@ojaven/db";
import { invoices, payments } from "@ojaven/db";

await db.batch([
  db.insert(invoices).values({ ... }),
  db.insert(payments).values({ ... }),
]);
```

**Pool/websocket driver — for the rare case that genuinely needs interactive transactions.** Reserve this for flows with branching logic inside the transaction — read a row, decide something based on it, write more rows, all-or-nothing. The two known cases so far:

- **Billing settlement** — e.g. marking an invoice paid, recording the payment, and updating client status, where a failure partway through must roll everything back.
- **Atomic deal-conversion flows** — e.g. deal → client + contact + first invoice created together.

Do NOT default to this driver for routine writes — it's Node.js runtime only (not Edge-deployable), and most of the app doesn't need it.

```ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@ojaven/db/schema";

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const txDb = drizzle(pool, { schema });

await txDb.transaction(async (tx) => {
  const invoice = await tx.query.invoices.findFirst({ where: ... });
  if (invoice.status !== "sent") throw new Error("not payable");
  await tx.update(invoices).set({ status: "paid" }).where(...);
  await tx.insert(payments).values({ ... });
});
```

This isn't wired up as a shared export yet — when the first transaction-requiring route is built, add a `src/transactionClient.ts` that exports a configured `txDb`, rather than each call site standing up its own `Pool`.

## Schema conventions

- Every tenant-scoped table has `agencyId` (FK, cascade delete).
- Every table has `createdAt`/`updatedAt` (`timestamptz`, via the shared `timestamps` helper in `_helpers.ts`).
- Soft-delete (`deletedAt`) only where a row can meaningfully be "trashed and restored" — not on immutable/log-style tables (`auditLogs`, `emailSends`, `activities`).
- All IDs are UUIDs **except `users.id`**, which is Clerk's own user id (`text`) — deliberate, so webhook events join back to the row without an extra lookup column.
- Enums (`_enums.ts`) for every status/type field.
- Money fields are `numeric(12, 2)`, never `float`.
- No derived/snapshot columns without a write path that keeps them current — e.g. there's no `clients.mrr`; it's computed at query time from `sum(deals.mrr) where status = 'won'`. If a column can drift out of sync with nothing updating it, don't add the column — add a query helper instead.
