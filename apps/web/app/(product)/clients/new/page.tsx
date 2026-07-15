"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClientSchema, type CreateClientInput, clientStatusValues } from "@ojaven/shared";
import { trpc } from "@/lib/trpc/client";

export default function NewClientPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    defaultValues: { status: "prospect" },
  });

  const createClient = trpc.clients.create.useMutation({
    onSuccess: async (client) => {
      await utils.clients.list.invalidate();
      if (client) router.push(`/clients/${client.id}`);
    },
  });

  const onSubmit = handleSubmit((data) => createClient.mutate(data));

  return (
    <div style={{ padding: "2rem", maxWidth: "480px" }}>
      <h1>New client</h1>

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

        {createClient.error && <p style={{ color: "#D97706" }}>{createClient.error.message}</p>}

        <button type="submit" disabled={isSubmitting || createClient.isPending}>
          {createClient.isPending ? "Creating…" : "Create client"}
        </button>
      </form>
    </div>
  );
}
