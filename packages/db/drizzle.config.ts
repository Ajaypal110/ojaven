import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Single source of truth for env vars lives in apps/web/.env.local —
// loaded explicitly here since drizzle-kit runs from packages/db.
config({ path: "../../apps/web/.env.local" });

if (!process.env.DATABASE_URL_UNPOOLED) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Add it to apps/web/.env.local."
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED,
  },
  // strict:false — a bare-Postgres push otherwise blocks on an interactive
  // confirmation prompt, which a non-interactive shell can't answer. Safe
  // here since --force (auto-approve DATA LOSS statements) stays off, so
  // anything genuinely destructive still fails closed rather than applying
  // silently. Revisit once this runs from an interactive terminal regularly.
  strict: false,
  verbose: true,
});
