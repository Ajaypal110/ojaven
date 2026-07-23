"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateClientSchema, type UpdateClientInput, clientStatusValues } from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";
import { ContactsSection } from "./ContactsSection";
import { TagsSection } from "./TagsSection";
import { CustomFieldsSection } from "./CustomFieldsSection";
import { TasksSection } from "./TasksSection";
import { TimeSection } from "./TimeSection";
import { ProposalsSection } from "./ProposalsSection";
import { InvoicesSection } from "./InvoicesSection";
import { ActivityTimeline } from "./ActivityTimeline";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const client = trpc.clients.byId.useQuery({ id: params.id });
  const membership = trpc.team.myMembership.useQuery();
  // Structure = owner/admin (definition management). Data (attach tags, fill
  // field values) is every role. The server enforces this too — the flag only
  // gates what the UI offers.
  const canStructure =
    membership.data?.role === "owner" || membership.data?.role === "admin";

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateClientInput>({
    resolver: zodResolver(updateClientSchema),
  });

  // Pre-fill the edit form once the client data loads (or changes).
  useEffect(() => {
    if (client.data) {
      reset({
        name: client.data.name,
        website: client.data.website ?? "",
        industry: client.data.industry ?? "",
        status: client.data.status,
      });
    }
  }, [client.data, reset]);

  const updateClient = trpc.clients.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.clients.byId.invalidate({ id: params.id }),
        utils.clients.list.invalidate(),
      ]);
      setIsEditing(false);
    },
  });

  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: async () => {
      await utils.clients.list.invalidate();
      router.push("/clients");
    },
  });

  const onSubmit = handleSubmit((data) => updateClient.mutate({ id: params.id, ...data }));

  return (
    <div style={{ padding: "2rem", maxWidth: "480px" }}>
      <Link href="/clients">&larr; Clients</Link>

      {client.isLoading && <p>Loading…</p>}
      {client.error && <p>Error: {client.error.message}</p>}

      {client.data && !isEditing && (
        <>
          <h1 style={{ marginTop: "1rem" }}>{client.data.name}</h1>
          <dl style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
            <div>
              <dt style={{ color: "#888", fontSize: "0.875rem" }}>Status</dt>
              <dd>{client.data.status}</dd>
            </div>
            {client.data.website && (
              <div>
                <dt style={{ color: "#888", fontSize: "0.875rem" }}>Website</dt>
                <dd>{client.data.website}</dd>
              </div>
            )}
            {client.data.industry && (
              <div>
                <dt style={{ color: "#888", fontSize: "0.875rem" }}>Industry</dt>
                <dd>{client.data.industry}</dd>
              </div>
            )}
          </dl>

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button type="button" onClick={() => setIsEditing(true)}>
              Edit
            </button>

            {!isConfirmingDelete && (
              <button type="button" onClick={() => setIsConfirmingDelete(true)}>
                Delete
              </button>
            )}
          </div>

          {isConfirmingDelete && (
            <div style={{ marginTop: "0.75rem" }}>
              <p>Delete this client? This can&apos;t be undone from here.</p>
              {deleteClient.error && (
                <p style={{ color: "#D97706" }}>{deleteClient.error.message}</p>
              )}
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  disabled={deleteClient.isPending}
                  onClick={() => deleteClient.mutate({ id: params.id })}
                >
                  {deleteClient.isPending ? "Deleting…" : "Confirm delete"}
                </button>
                <button type="button" onClick={() => setIsConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {client.data && isEditing && (
        <form onSubmit={onSubmit} style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
          <div>
            <label htmlFor="name">Name</label>
            <br />
            <input id="name" {...register("name")} />
            {errors.name && <p style={{ color: "#D97706" }}>{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="website">Website</label>
            <br />
            <input id="website" placeholder="https://example.com" {...register("website")} />
            {errors.website && <p style={{ color: "#D97706" }}>{errors.website.message}</p>}
          </div>

          <div>
            <label htmlFor="industry">Industry</label>
            <br />
            <input id="industry" {...register("industry")} />
          </div>

          <div>
            <label htmlFor="status">Status</label>
            <br />
            <select id="status" {...register("status")}>
              {clientStatusValues.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {updateClient.error && (
            <p style={{ color: "#D97706" }}>{updateClient.error.message}</p>
          )}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="submit" disabled={isSubmitting || updateClient.isPending}>
              {updateClient.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {client.data && (
        <>
          <ContactsSection clientId={params.id} />
          <TagsSection entityType="client" entityId={params.id} canStructure={canStructure} />
          <CustomFieldsSection
            entityType="client"
            entityId={params.id}
            canStructure={canStructure}
          />
          <TasksSection clientId={params.id} />
          <TimeSection clientId={params.id} />
          <ProposalsSection clientId={params.id} />
          <InvoicesSection clientId={params.id} />
          <ActivityTimeline entityType="client" entityId={params.id} />
        </>
      )}
    </div>
  );
}
