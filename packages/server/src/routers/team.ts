import {
  inviteTeamMemberSchema,
  teamMemberIdSchema,
  updateTeamMemberRoleSchema,
} from "@ojaven/shared";
import { router } from "../trpc";
import { agencyProcedure, teamProcedure } from "../procedures";
import {
  ensureMembership,
  inviteMember,
  listMembers,
  promoteToCoOwner,
  removeMember,
  stepDownAsOwner,
  transferOwnership,
  updateMemberRole,
} from "../services/teamMembership";
import {
  cancelOwnershipRecovery,
  completeOwnershipRecovery,
  requestOwnershipRecovery,
} from "../services/ownershipRecovery";
import { liveClerkGateway } from "../services/liveClerkGateway";

export const teamRouter = router({
  /** Roster + the caller's own membership, so the UI can gate controls per the role matrix. */
  list: teamProcedure.query(async ({ ctx }) => ({
    callerMemberId: ctx.teamMember.id,
    callerRole: ctx.teamMember.role,
    members: await listMembers(ctx.agencyId),
  })),

  /**
   * The caller's own membership, alone — the standard "what's my role"
   * query for every gated page. Exists so pages that only gate rendering
   * don't overfetch the whole roster via team.list (trivial at 2 members,
   * a waste pattern at 30 members x 18 modules).
   */
  myMembership: teamProcedure.query(({ ctx }) => ctx.teamMember),

  /**
   * The explicit bootstrap path — agencyProcedure, not teamProcedure
   * (chicken/egg: it creates the very row teamProcedure requires).
   * Idempotent; called by onboarding and the (product) layout effect.
   */
  ensureMembership: agencyProcedure.mutation(({ ctx }) =>
    ensureMembership({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      clerkOrgRole: ctx.clerkOrgRole,
    })
  ),

  invite: teamProcedure.input(inviteTeamMemberSchema).mutation(({ ctx, input }) =>
    inviteMember({
      agencyId: ctx.agencyId,
      clerkOrgId: ctx.clerkOrgId,
      actor: { userId: ctx.userId, role: ctx.teamMember.role },
      email: input.email,
      role: input.role,
      gateway: liveClerkGateway,
    })
  ),

  updateRole: teamProcedure.input(updateTeamMemberRoleSchema).mutation(({ ctx, input }) =>
    updateMemberRole({
      agencyId: ctx.agencyId,
      actor: { userId: ctx.userId },
      memberId: input.memberId,
      role: input.role,
    })
  ),

  remove: teamProcedure.input(teamMemberIdSchema).mutation(({ ctx, input }) =>
    removeMember({
      agencyId: ctx.agencyId,
      clerkOrgId: ctx.clerkOrgId,
      actor: { userId: ctx.userId },
      memberId: input.memberId,
      gateway: liveClerkGateway,
    })
  ),

  transferOwnership: teamProcedure.input(teamMemberIdSchema).mutation(({ ctx, input }) =>
    transferOwnership({
      agencyId: ctx.agencyId,
      actor: { userId: ctx.userId },
      toMemberId: input.memberId,
    })
  ),

  promoteToCoOwner: teamProcedure.input(teamMemberIdSchema).mutation(({ ctx, input }) =>
    promoteToCoOwner({
      agencyId: ctx.agencyId,
      actor: { userId: ctx.userId },
      toMemberId: input.memberId,
    })
  ),

  stepDownAsOwner: teamProcedure.mutation(({ ctx }) =>
    stepDownAsOwner({ agencyId: ctx.agencyId, actor: { userId: ctx.userId } })
  ),

  requestOwnershipRecovery: teamProcedure.mutation(({ ctx }) =>
    requestOwnershipRecovery({
      agencyId: ctx.agencyId,
      actor: { userId: ctx.userId },
      gateway: liveClerkGateway,
    })
  ),

  cancelOwnershipRecovery: teamProcedure.mutation(({ ctx }) =>
    cancelOwnershipRecovery({ agencyId: ctx.agencyId, actor: { userId: ctx.userId } })
  ),

  completeOwnershipRecovery: teamProcedure.mutation(({ ctx }) =>
    completeOwnershipRecovery({
      agencyId: ctx.agencyId,
      actor: { userId: ctx.userId },
      gateway: liveClerkGateway,
    })
  ),
});
