import { clerkClient } from "@clerk/nextjs/server";
import type { ClerkGateway } from "./clerkGateway";

/** Production ClerkGateway. Next.js runtime only — never import from tests. */
export const liveClerkGateway: ClerkGateway = {
  async getUserLastSignInAt(userIds) {
    const client = await clerkClient();
    const result = new Map<string, number | null>();
    const { data } = await client.users.getUserList({ userId: userIds, limit: userIds.length });
    for (const user of data) {
      result.set(user.id, user.lastSignInAt);
    }
    return result;
  },

  async createOrganizationInvitation({ clerkOrgId, inviterUserId, email, clerkRole }) {
    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: clerkOrgId,
      inviterUserId,
      emailAddress: email,
      role: clerkRole,
    });
    return invitation.id;
  },

  async removeOrganizationMember({ clerkOrgId, clerkUserId }) {
    const client = await clerkClient();
    await client.organizations.deleteOrganizationMembership({
      organizationId: clerkOrgId,
      userId: clerkUserId,
    });
  },
};
