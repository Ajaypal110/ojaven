import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  db,
  agencies,
  agencySettings,
  invitations,
  teamMembers,
  teamMemberRoleEnum,
  users,
} from "@ojaven/db";
import { logger } from "@ojaven/shared";

type TeamMemberRole = (typeof teamMemberRoleEnum.enumValues)[number];

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

        await upsertUser({
          id,
          email: email.toLowerCase(),
          firstName: first_name ?? null,
          lastName: last_name ?? null,
          imageUrl: image_url ?? null,
        });
        break;
      }

      case "user.deleted": {
        if (evt.data.id) await softDeleteUser(evt.data.id);
        break;
      }

      case "organization.created":
      case "organization.updated": {
        const { id, name, slug } = evt.data;
        await upsertAgency({ clerkOrgId: id, name, subdomainFallback: slug ?? id });
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

async function upsertUser(params: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}) {
  await db
    .insert(users)
    .values(params)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        imageUrl: params.imageUrl,
        updatedAt: new Date(),
      },
    });
}

async function softDeleteUser(clerkUserId: string) {
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, clerkUserId));
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

  const role = await resolveRole(agency.id, params.clerkUserId, params.clerkRole);

  await insertMembership({
    agencyId: agency.id,
    userId: params.clerkUserId,
    role,
    clerkMembershipId: params.clerkMembershipId,
  });
}

/**
 * Role resolution order:
 * 1. A pending invitation from our own `invitations` table (agencyId +
 *    email match) — the only place manager/operator ever comes from,
 *    since Clerk's own role is just a binary org:admin/org:member split.
 * 2. No existing team_members row for this agency yet → this is the org
 *    creator → 'owner'.
 * 3. Otherwise, map Clerk's binary role as a fallback default (someone
 *    added directly via Clerk's dashboard, bypassing our invite flow).
 */
async function resolveRole(
  agencyId: string,
  clerkUserId: string,
  clerkRole: string
): Promise<TeamMemberRole> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, clerkUserId)).limit(1);

  if (user) {
    const [invitation] = await db
      .select({ id: invitations.id, role: invitations.role })
      .from(invitations)
      .where(
        and(
          eq(invitations.agencyId, agencyId),
          eq(invitations.email, user.email),
          eq(invitations.status, "pending")
        )
      )
      .limit(1);

    if (invitation) {
      await db
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      return invitation.role;
    }
  }

  const [existingMember] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.agencyId, agencyId))
    .limit(1);

  if (!existingMember) return "owner";

  return clerkRole === "org:admin" ? "admin" : "operator";
}

async function insertMembership(params: {
  agencyId: string;
  userId: string;
  role: TeamMemberRole;
  clerkMembershipId: string;
}) {
  try {
    await db
      .insert(teamMembers)
      .values(params)
      .onConflictDoUpdate({
        target: teamMembers.clerkMembershipId,
        set: { role: params.role, deletedAt: null, updatedAt: new Date() },
      });
  } catch (err) {
    // Unique-owner race: someone else became owner between resolveRole()'s
    // check and this insert (see the team_members_one_owner_per_agency
    // partial index in packages/db). Retry once as admin.
    if (params.role === "owner" && isUniqueViolation(err)) {
      logger.warn({ agencyId: params.agencyId }, "clerk webhook: owner race detected, retrying as admin");
      await db
        .insert(teamMembers)
        .values({ ...params, role: "admin" })
        .onConflictDoUpdate({
          target: teamMembers.clerkMembershipId,
          set: { role: "admin", deletedAt: null, updatedAt: new Date() },
        });
      return;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505");
}
