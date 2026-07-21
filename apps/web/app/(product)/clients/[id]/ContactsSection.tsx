"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { createContactSchema, updateContactSchema } from "@ojaven/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type Contact = inferRouterOutputs<AppRouter>["contacts"]["listByClient"][number];

// Add form reuses the shared create schema minus clientId (injected on submit).
// Edit form reuses the shared update schema minus isPrimary — primacy is
// changed ONLY through the dedicated "Make primary" control, never a field
// buried in the edit form. Both keep the shared email-lowercasing + required
// firstName from @ojaven/shared, so client-side validation can't drift from
// the server's.
const addSchema = createContactSchema.omit({ clientId: true });
type AddValues = z.input<typeof addSchema>;
const editSchema = updateContactSchema.omit({ isPrimary: true });
type EditValues = z.input<typeof editSchema>;

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.875rem" } as const;
const badge = {
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#0A0A0A",
  background: "#F5C451",
  padding: "0.1rem 0.45rem",
  borderRadius: 4,
} as const;
const card = { border: "1px solid #333", borderRadius: 6, padding: "0.75rem" } as const;
const field = { display: "grid", gap: "0.25rem" } as const;

export function ContactsSection({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const contacts = trpc.contacts.listByClient.useQuery({ clientId });
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = () => utils.contacts.listByClient.invalidate({ clientId });

  // The primary toggle and delete both re-read from the server after writing —
  // the list re-renders off fresh query data (primary-first, exactly one
  // isPrimary), so the badge can never land on a stale row.
  const makePrimary = trpc.contacts.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.contacts.delete.useMutation({
    onSuccess: async () => {
      await invalidate();
      setConfirmDeleteId(null);
    },
  });

  const list = contacts.data ?? [];

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Contacts</h2>
        {!showAdd && (
          <button type="button" onClick={() => setShowAdd(true)}>
            Add contact
          </button>
        )}
      </div>

      {showAdd && <AddContactForm clientId={clientId} onDone={() => setShowAdd(false)} />}

      {contacts.isLoading && <p style={muted}>Loading…</p>}
      {contacts.error && <p style={warn}>{contacts.error.message}</p>}
      {makePrimary.error && <p style={warn}>{makePrimary.error.message}</p>}
      {!contacts.isLoading && list.length === 0 && !showAdd && (
        <p style={muted}>No contacts yet.</p>
      )}

      <ul
        style={{ listStyle: "none", padding: 0, marginTop: "1rem", display: "grid", gap: "0.75rem" }}
      >
        {list.map((c) =>
          editingId === c.id ? (
            <li key={c.id}>
              <EditContactForm contact={c} onDone={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={c.id} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <strong>
                  {c.firstName}
                  {c.lastName ? ` ${c.lastName}` : ""}
                </strong>
                {c.isPrimary && <span style={badge}>Primary</span>}
              </div>
              {c.title && <div style={muted}>{c.title}</div>}
              {c.email && <div style={muted}>{c.email}</div>}
              {c.phone && <div style={muted}>{c.phone}</div>}

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                {!c.isPrimary && (
                  <button
                    type="button"
                    disabled={makePrimary.isPending}
                    onClick={() => makePrimary.mutate({ id: c.id, isPrimary: true })}
                  >
                    Make primary
                  </button>
                )}
                <button type="button" onClick={() => setEditingId(c.id)}>
                  Edit
                </button>
                {confirmDeleteId === c.id ? (
                  <>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: c.id })}
                    >
                      {remove.isPending ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteId(c.id)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

function AddContactForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const create = trpc.contacts.create.useMutation({
    onSuccess: async () => {
      await utils.contacts.listByClient.invalidate({ clientId });
      onDone();
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", title: "", isPrimary: false },
  });

  const onSubmit = handleSubmit((values) => create.mutate({ clientId, ...values }));

  return (
    <form onSubmit={onSubmit} style={{ ...card, marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
      <ContactFields register={register} errors={errors} />
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <input type="checkbox" {...register("isPrimary")} /> Set as primary
      </label>
      {create.error && <p style={warn}>{create.error.message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditContactForm({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.contacts.update.useMutation({
    onSuccess: async () => {
      await utils.contacts.listByClient.invalidate({ clientId: contact.clientId });
      onDone();
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      firstName: contact.firstName,
      lastName: contact.lastName ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      title: contact.title ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => update.mutate({ id: contact.id, ...values }));

  return (
    <form onSubmit={onSubmit} style={{ ...card, display: "grid", gap: "0.75rem" }}>
      <ContactFields register={register} errors={errors} />
      {update.error && <p style={warn}>{update.error.message}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The five shared text fields. Typed loosely (the two forms have different
 * value shapes but identical field names) — the shared Zod schema is the real
 * validation boundary; these props just wire inputs.
 */
function ContactFields({
  register,
  errors,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: any;
}) {
  return (
    <>
      <div style={field}>
        <label>First name</label>
        <input {...register("firstName")} />
        {errors.firstName && <span style={warn}>{errors.firstName.message}</span>}
      </div>
      <div style={field}>
        <label>Last name</label>
        <input {...register("lastName")} />
      </div>
      <div style={field}>
        <label>Title</label>
        <input {...register("title")} />
      </div>
      <div style={field}>
        <label>Email</label>
        <input {...register("email")} placeholder="name@example.com" />
        {errors.email && <span style={warn}>{errors.email.message}</span>}
      </div>
      <div style={field}>
        <label>Phone</label>
        <input {...register("phone")} />
      </div>
    </>
  );
}
