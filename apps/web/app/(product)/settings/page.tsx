"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  changeSubdomainSchema,
  updateSettingsSchema,
  type ChangeSubdomainInput,
  type UpdateSettingsInput,
} from "@ojaven/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type SettingsData = inferRouterOutputs<AppRouter>["settings"]["get"];

const err = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.875rem" } as const;
const row = { margin: "0.75rem 0" } as const;

const TIMEZONES =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const membership = trpc.team.myMembership.useQuery();
  const settings = trpc.settings.get.useQuery();

  const canStructure =
    membership.data?.role === "owner" || membership.data?.role === "admin";

  if (settings.isLoading || membership.isLoading) {
    return <Shell><p>Loading…</p></Shell>;
  }
  if (settings.error) {
    return <Shell><p style={err}>Error: {settings.error.message}</p></Shell>;
  }
  if (!settings.data) return <Shell><p>Loading…</p></Shell>;

  return (
    <Shell>
      {canStructure ? (
        <EditableSettings data={settings.data} onSaved={() => utils.settings.get.invalidate()} />
      ) : (
        <ReadOnlySettings data={settings.data} />
      )}
    </Shell>
  );
}

/** Operator/manager view: plain values, zero controls — the role-wiring proof. */
function ReadOnlySettings({ data }: { data: SettingsData }) {
  return (
    <>
      <p style={muted}>You have read-only access to agency settings.</p>
      <dl>
        <Field label="Name" value={data.name} />
        <Field label="Subdomain" value={`${data.subdomain}.ojaven.com`} />
        <Field label="Logo URL" value={data.logoUrl ?? "—"} />
        <Field label="Primary color" value={data.primaryColor ?? "—"} />
        <Field label="Timezone" value={data.timezone} />
        <Field label="Currency" value={data.currency} />
      </dl>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={row}>
      <dt style={muted}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EditableSettings({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const update = trpc.settings.update.useMutation({ onSuccess: onSaved });

  const {
    register,
    handleSubmit,
    reset,
    formState: { dirtyFields, isDirty },
  } = useForm<UpdateSettingsInput>({
    resolver: zodResolver(updateSettingsSchema),
  });

  // Seed the form from server data once loaded.
  useEffect(() => {
    reset({
      name: data.name,
      logoUrl: data.logoUrl ?? "",
      primaryColor: data.primaryColor ?? "#000000",
      timezone: data.timezone,
      currency: data.currency,
    });
  }, [data, reset]);

  const onSubmit = handleSubmit((values) => {
    // Send only changed fields — presence-based no-clobber, mirrors the
    // service. Empty logoUrl means "clear it" (null).
    const patch: UpdateSettingsInput = {};
    if (dirtyFields.name) patch.name = values.name;
    if (dirtyFields.logoUrl) patch.logoUrl = values.logoUrl ? values.logoUrl : null;
    if (dirtyFields.primaryColor) patch.primaryColor = values.primaryColor;
    if (dirtyFields.timezone) patch.timezone = values.timezone;
    if (dirtyFields.currency) patch.currency = values.currency;
    if (Object.keys(patch).length === 0) return;
    update.mutate(patch, { onSuccess: () => reset(values) });
  });

  return (
    <>
      <form onSubmit={onSubmit} style={{ maxWidth: "420px" }}>
        <div style={row}>
          <label htmlFor="name">Agency name</label>
          <br />
          <input id="name" {...register("name")} />
        </div>
        <div style={row}>
          <label htmlFor="logoUrl">Logo URL</label>
          <br />
          <input id="logoUrl" placeholder="https://…" {...register("logoUrl")} />
        </div>
        <div style={row}>
          <label htmlFor="primaryColor">Primary color</label>
          <br />
          <input id="primaryColor" type="color" {...register("primaryColor")} />
        </div>
        <div style={row}>
          <label htmlFor="timezone">Timezone</label>
          <br />
          <select id="timezone" {...register("timezone")}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div style={row}>
          <label htmlFor="currency">Currency (ISO 4217)</label>
          <br />
          <input id="currency" maxLength={3} style={{ width: "5rem" }} {...register("currency")} />
        </div>

        {update.error && <p style={err}>{update.error.message}</p>}
        {update.isSuccess && !isDirty && <p style={muted}>Saved.</p>}

        <button type="submit" disabled={update.isPending || !isDirty}>
          {update.isPending ? "Saving…" : "Save settings"}
        </button>
      </form>

      <hr style={{ margin: "2rem 0", borderColor: "#333" }} />
      <SubdomainForm current={data.subdomain} onSaved={onSaved} />
    </>
  );
}

function SubdomainForm({ current, onSaved }: { current: string; onSaved: () => void }) {
  const change = trpc.settings.changeSubdomain.useMutation({ onSuccess: onSaved });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangeSubdomainInput>({
    resolver: zodResolver(changeSubdomainSchema),
    defaultValues: { subdomain: current },
  });

  const onSubmit = handleSubmit((values) => change.mutate(values));

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: "420px" }}>
      <h2>Subdomain</h2>
      <p style={muted}>Your workspace lives at &lt;subdomain&gt;.ojaven.com</p>
      <div style={row}>
        <input {...register("subdomain")} />
        <span style={muted}>.ojaven.com</span>
        {/* Client-side reserved-word / format rejection (shared schema). */}
        {errors.subdomain && <p style={err}>{errors.subdomain.message}</p>}
      </div>
      {/* Server-side collision CONFLICT. */}
      {change.error && <p style={err}>{change.error.message}</p>}
      {change.isSuccess && <p style={muted}>Subdomain updated.</p>}
      <button type="submit" disabled={change.isPending}>
        {change.isPending ? "Changing…" : "Change subdomain"}
      </button>
    </form>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2rem", maxWidth: "640px" }}>
      <Link href="/dashboard">&larr; Dashboard</Link>
      <h1 style={{ margin: "1rem 0" }}>Agency settings</h1>
      {children}
    </div>
  );
}
