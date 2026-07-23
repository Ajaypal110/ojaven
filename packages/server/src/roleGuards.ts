import { TRPCError } from "@trpc/server";
import type { teamMemberRoleEnum } from "@ojaven/db";

export type TeamRole = (typeof teamMemberRoleEnum.enumValues)[number];

/**
 * The data-vs-structure permission split, named as a pattern in the pipeline
 * design review and shared across every structure-gated router: DATA
 * operations run on agencyProcedure (all roles); STRUCTURE/configuration
 * (pipeline shape, agency settings, ...) is owner/admin only. `resource`
 * makes the refusal message specific.
 */
export function assertStructureRole(role: TeamRole, resource: string) {
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Only owners and admins can change ${resource}.`,
    });
  }
}

/**
 * Review authority: manager and above. The MIDDLE tier — operators create and
 * submit, managers+ sign off. This is where manager ≠ operator first earns its
 * keep (junior writes, senior approves); the tier will recur in later modules.
 */
export function assertReviewRole(role: TeamRole, resource: string) {
  if (role !== "owner" && role !== "admin" && role !== "manager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Only managers and above can review ${resource}.`,
    });
  }
}
