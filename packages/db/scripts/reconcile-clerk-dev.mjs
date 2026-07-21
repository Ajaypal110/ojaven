/**
 * Dev-only reconciliation: make the Neon DB match Clerk's live truth.
 *
 * Local dev has no Clerk webhooks (Clerk can't reach localhost), so
 * user.deleted / organization.deleted never fire and the DB accumulates
 * orphans — rows whose Clerk account/org was deleted. Those orphans cause
 * confusing drift in test sessions (stale members, "account not found",
 * recycled-email collisions).
 *
 * This simulates exactly what those webhook handlers would have done,
 * using the same semantics as packages/server/src/services:
 *   - orphan users    -> tombstone (rename email to the reserved form +
 *                        soft-delete), matching handleUserDeleted and the
 *                        tombstoneEmail hex encoding.
 *   - orphan agencies -> soft-delete by clerk_org_id, matching
 *                        softDeleteAgencyByClerkOrgId.
 *
 * Idempotent and reversible (soft, not hard). Default is DRY-RUN; pass
 * --apply to execute. Lives under packages/db/ so it resolves
 * @neondatabase/serverless. Reads env from apps/web/.env.local.
 *
 *   node packages/db/scripts/reconcile-clerk-dev.mjs          # show plan
 *   node packages/db/scripts/reconcile-clerk-dev.mjs --apply  # execute
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../../apps/web/.env.local");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1);
}

const sql = neon(process.env.DATABASE_URL);
const H = { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` };
const clerk = async (path) => {
  const r = await fetch(`https://api.clerk.com/v1${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
};
const tombstoneEmail = (id) => `orphaned+${Buffer.from(id).toString("hex")}@tombstone.invalid`;

async function main() {
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY-RUN (pass --apply to execute)\n");

  const liveUserIds = new Set();
  const cu = await clerk("/users?limit=200");
  for (const u of Array.isArray(cu) ? cu : cu.data ?? []) liveUserIds.add(u.id);
  const liveOrgIds = new Set();
  const co = await clerk("/organizations?limit=200");
  for (const o of co.data ?? []) liveOrgIds.add(o.id);
  console.log(`Clerk live: ${liveUserIds.size} users, ${liveOrgIds.size} orgs\n`);

  const users = await sql`SELECT id, email FROM users WHERE deleted_at IS NULL`;
  const orphanUsers = users.filter((u) => !liveUserIds.has(u.id));
  console.log(`Orphan users (in DB, gone from Clerk): ${orphanUsers.length}`);
  for (const u of orphanUsers) console.log(`  ${u.id}  ${u.email}  -> tombstone`);

  const agencies = await sql`SELECT id, clerk_org_id, name FROM agencies WHERE deleted_at IS NULL`;
  const orphanAgencies = agencies.filter((a) => !liveOrgIds.has(a.clerk_org_id));
  console.log(`\nOrphan agencies (in DB, gone from Clerk): ${orphanAgencies.length}`);
  for (const a of orphanAgencies)
    console.log(`  ${a.id}  ${a.name}  (${a.clerk_org_id})  -> soft-delete`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to execute.");
    return;
  }

  for (const u of orphanUsers) {
    await sql`UPDATE users SET email = ${tombstoneEmail(u.id)}, deleted_at = now() WHERE id = ${u.id}`;
  }
  for (const a of orphanAgencies) {
    await sql`UPDATE agencies SET deleted_at = now() WHERE id = ${a.id}`;
  }
  console.log(
    `\nApplied: tombstoned ${orphanUsers.length} users, soft-deleted ${orphanAgencies.length} agencies.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
