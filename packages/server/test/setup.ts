import { readFileSync } from "node:fs";
import path from "node:path";

// Load apps/web/.env.local (the single env source of truth) before any
// test module imports @ojaven/db, whose client throws at import time if
// DATABASE_URL is unset. setupFiles run before test modules load.
const envPath = path.resolve(__dirname, "../../../apps/web/.env.local");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (!(key in process.env)) {
    process.env[key] = trimmed.slice(eq + 1);
  }
}
