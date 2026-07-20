import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, agencies, agencySettings, teamMembers } from "@ojaven/db";
import {
  ensureMembership,
  handleUserDeleted,
  liveClerkGateway,
  provisionUserRow,
  softDeleteAgencyByClerkOrgId,
} from "@ojaven/server";
import { logger } from "@ojaven/shared";

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    logger.error({ err }, "clerk webhook: signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const { id, email_addresses, primary_email_address_id, first_name, last_name, image_url } =
          evt.data;
        const email = email_addresses.find((e) => e.id === primary_email_address_id)?.email_address;

        if (!email) {
          logger.warn({ clerkUserId: id }, "clerk webhook: user has no primary email, skipping");
          break;
        }

        // Same shared write path as JIT provisioning — reclaim-aware, so a
        // recycled email tombstones its orphan instead of colliding.
        await provisionUserRow({
          gateway: liveClerkGateway,
          identity: {
            id,
            email: email.toLowerCase(),
            firstName: first_name ?? null,
            lastName: last_name ?? null,
            imageUrl: image_url ?? null,
          },
        });
        break;
      }

      case "user.deleted": {
        // Tombstones the email (not just soft-delete) so a same-email
        // re-signup doesn't collide on users.email — the production half of
        // the recycled-email fix.
        if (evt.data.id) await handleUserDeleted(evt.data.id);
        break;
      }

      case "organization.created":
      case "organization.updated": {
        const { id, name, slug } = evt.data;
        await upsertAgency({ clerkOrgId: id, name, subdomainFallback: slug ?? id });
        break;
      }

      case "organization.deleted": {
        if (evt.data.id) await softDeleteAgencyByClerkOrgId(evt.data.id);
        break;
      }

      case "organizationMembership.created": {
        const { id, organization, public_user_data, role } = evt.data;
        const clerkUserId = public_user_data?.user_id;

        if (!clerkUserId) {
          logger.warn(
            { clerkOrgId: organization.id },
            "clerk webhook: membership.created with no user_id, skipping"
          );
          break;
        }

        await syncMembershipCreated({
          clerkMembershipId: id,
          clerkOrgId: organization.id,
          clerkUserId,
          clerkRole: role,
        });
        break;
      }

      case "organizationMembership.deleted": {
        if (evt.data.id) await softDeleteMembership(evt.data.id);
        break;
      }

      default:
        // Not an event we sync — acknowledge and move on.
        break;
    }
  } catch (err) {
    // This endpoint has no UI — logging is the only visibility into a
    // failed sync. 500 (not 200) so Clerk retries; most failures here are
    // transient (a DB blip), and retrying is exactly what we want.
    logger.error({ err, eventType: evt.type }, "clerk webhook: handler failed");
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function upsertAgency(params: { clerkOrgId: string; name: string; subdomainFallback: string }) {
  await db
    .insert(agencies)
    .values({ clerkOrgId: params.clerkOrgId, name: params.name })
    .onConflictDoUpdate({
      target: agencies.clerkOrgId,
      set: { name: params.name, updatedAt: new Date() },
    });

  const [agency] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.clerkOrgId, params.clerkOrgId))
    .limit(1);

  if (!agency) return;

  // agency_settings.subdomain is NOT NULL with no default — create a
  // default row here too so every agency has one from the start, rather
  // than leaving it missing until someone visits a settings page.
  await db
    .insert(agencySettings)
    .values({ agencyId: agency.id, subdomain: params.subdomainFallback })
    .onConflictDoNothing({ target: agencySettings.agencyId });
}

async function softDeleteMembership(clerkMembershipId: string) {
  await db
    .update(teamMembers)
    .set({ deletedAt: new Date() })
    .where(eq(teamMembers.clerkMembershipId, clerkMembershipId));
}

/**
 * Membership sync now delegates to the shared, advisory-lock-protected
 * service (packages/server/src/services/teamMembership.ts) — the same
 * function team.ensureMembership calls, so the webhook and the explicit
 * bootstrap path can't drift. Role resolution (pending invitation ->
 * first-member-owner -> Clerk-role fallback) and race handling live there.
 */
async function syncMembershipCreated(params: {
  clerkMembershipId: string;
  clerkOrgId: string;
  clerkUserId: string;
  clerkRole: string;
}) {
  const [agency] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.clerkOrgId, params.clerkOrgId))
    .limit(1);

  if (!agency) {
    // Clerk sends organization.created before any membership event for
    // that org, so this genuinely shouldn't happen — throwing lets Clerk
    // retry the delivery rather than silently dropping the membership.
    throw new Error(
      `No agency synced yet for clerk org ${params.clerkOrgId} while processing membership.created`
    );
  }

  await ensureMembership({
    agencyId: agency.id,
    userId: params.clerkUserId,
    clerkOrgRole: params.clerkRole,
    clerkMembershipId: params.clerkMembershipId,
  });
}
