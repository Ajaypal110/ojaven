"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  inviteTeamMemberSchema,
  invitableRoleValues,
  type InviteTeamMemberInput,
} from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";

type Role = "owner" | "admin" | "manager" | "operator";

/**
 * Mirror of the server-side role matrix, for rendering only — the services
 * re-enforce every rule, so a UI mistake here can annoy but never breach.
 */
function canAdminister(caller: { memberId: string; role: Role }, target: { id: string; role: Role }) {
  if (target.id === caller.memberId) return false;
  if (target.role === "owner") return false;
  if (caller.role === "owner") return true;
  if (caller.role === "admin") return target.role === "manager" || target.role === "operator";
  return false;
}

export default function TeamPage() {
  const utils = trpc.useUtils();
  const team = trpc.team.list.useQuery();

  const invalidate = () => utils.team.list.invalidate();
  const invite = trpc.team.invite.useMutation({
    onSuccess: () => {
      invalidate();
      reset();
    },
  });
  const updateRole = trpc.team.updateRole.useMutation({ onSuccess: invalidate });
  const promote = trpc.team.promoteToCoOwner.useMutation({ onSuccess: invalidate });
  const remove = trpc.team.remove.useMutation({
    onSuccess: () => {
      invalidate();
      setConfirmingRemoveId(null);
    },
  });
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteTeamMemberInput>({
    resolver: zodResolver(inviteTeamMemberSchema),
    defaultValues: { role: "operator" },
  });

  const onInvite = handleSubmit((data) => invite.mutate(data));

  const caller = team.data
    ? { memberId: team.data.callerMemberId, role: team.data.callerRole }
    : null;
  const canInvite = caller?.role === "owner" || caller?.role === "admin";

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <Link href="/dashboard">&larr; Dashboard</Link>
      <h1 style={{ marginTop: "1rem" }}>Team</h1>

      {team.isLoading && <p>Loading…</p>}
      {team.error && <p>Error: {team.error.message}</p>}

      {team.data && caller && (
        <>
          <ul style={{ marginTop: "1rem", listStyle: "none", padding: 0 }}>
            {team.data.members.map((member) => {
              const name =
                [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email;
              const manageable = canAdminister(caller, member);
              return (
                <li
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.75rem 0",
                    borderBottom: "1px solid #333",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div>
                      {name}
                      {member.id === caller.memberId && (
                        <span style={{ color: "#888" }}> (you)</span>
                      )}
                    </div>
                    <div style={{ color: "#888", fontSize: "0.875rem" }}>{member.email}</div>
                  </div>

                  {manageable ? (
                    <>
                      <label htmlFor={`role-${member.id}`} style={{ position: "absolute", left: "-9999px" }}>
                        Role for {name}
                      </label>
                      <select
                        id={`role-${member.id}`}
                        value={member.role}
                        disabled={updateRole.isPending}
                        onChange={(e) =>
                          updateRole.mutate({
                            memberId: member.id,
                            role: e.target.value as (typeof invitableRoleValues)[number],
                          })
                        }
                      >
                        {invitableRoleValues.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      {caller.role === "owner" && (
                        <button
                          type="button"
                          disabled={promote.isPending}
                          onClick={() => promote.mutate({ memberId: member.id })}
                        >
                          Make co-owner
                        </button>
                      )}
                      {confirmingRemoveId === member.id ? (
                        <>
                          <button
                            type="button"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate({ memberId: member.id })}
                          >
                            {remove.isPending ? "Removing…" : "Confirm remove"}
                          </button>
                          <button type="button" onClick={() => setConfirmingRemoveId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmingRemoveId(member.id)}>
                          Remove
                        </button>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "#D97706", fontSize: "0.875rem" }}>{member.role}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {(updateRole.error || promote.error || remove.error) && (
            <p style={{ color: "#D97706" }}>
              {updateRole.error?.message ?? promote.error?.message ?? remove.error?.message}
            </p>
          )}

          {canInvite && (
            <form onSubmit={onInvite} style={{ marginTop: "2rem", display: "grid", gap: "1rem", maxWidth: "420px" }}>
              <h2>Invite a member</h2>
              <div>
                <label htmlFor="invite-email">Email</label>
                <br />
                <input id="invite-email" type="email" placeholder="them@agency.com" {...register("email")} />
                {errors.email && <p style={{ color: "#D97706" }}>{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="invite-role">Role</label>
                <br />
                <select id="invite-role" {...register("role")}>
                  {invitableRoleValues.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              {invite.error && <p style={{ color: "#D97706" }}>{invite.error.message}</p>}
              {invite.isSuccess && <p style={{ color: "#D97706" }}>Invitation sent.</p>}
              <button type="submit" disabled={invite.isPending}>
                {invite.isPending ? "Sending…" : "Send invite"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
