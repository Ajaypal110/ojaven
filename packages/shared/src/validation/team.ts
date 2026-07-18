import { z } from "zod";

export const teamMemberRoleValues = ["owner", "admin", "manager", "operator"] as const;

/**
 * Roles an invitation may carry — deliberately excludes "owner". Owner is
 * only ever reachable via first-member bootstrap, transferOwnership, or
 * promoteToCoOwner, so `role: "owner"` in an invite is a clean Zod 400
 * before it gets anywhere near the database.
 */
export const invitableRoleValues = ["admin", "manager", "operator"] as const;

export const inviteTeamMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320),
  role: z.enum(invitableRoleValues),
});
export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;

export const updateTeamMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(invitableRoleValues), // owner not assignable here either — transfer/promote only
});
export type UpdateTeamMemberRoleInput = z.infer<typeof updateTeamMemberRoleSchema>;

export const teamMemberIdSchema = z.object({
  memberId: z.string().uuid(),
});
export type TeamMemberIdInput = z.infer<typeof teamMemberIdSchema>;
