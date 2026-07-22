"use client";

import { useState } from "react";
import { fieldTypeValues, type EntityType, type FieldType } from "@ojaven/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@ojaven/server";
import { trpc } from "@/lib/trpc/client";

type FieldValue = inferRouterOutputs<AppRouter>["customFields"]["listValuesForEntity"][number];

const warn = { color: "#D97706" } as const;
const muted = { color: "#888", fontSize: "0.875rem" } as const;
const rowStyle = { display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" } as const;

export function CustomFieldsSection({
  entityType,
  entityId,
  canStructure,
}: {
  entityType: EntityType;
  entityId: string;
  canStructure: boolean;
}) {
  const values = trpc.customFields.listValuesForEntity.useQuery({ entityType, entityId });
  const [showManager, setShowManager] = useState(false);

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #333", paddingTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Custom fields</h2>
        {canStructure && (
          <button type="button" onClick={() => setShowManager((s) => !s)}>
            {showManager ? "Done" : "Manage fields"}
          </button>
        )}
      </div>

      {values.isLoading && <p style={muted}>Loading…</p>}
      {!values.isLoading && values.data?.length === 0 && (
        <p style={muted}>
          No custom fields defined{canStructure ? " — add one below." : "."}
        </p>
      )}

      <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        {(values.data ?? []).map((field) => (
          <FieldValueRow
            key={field.fieldId}
            entityType={entityType}
            entityId={entityId}
            field={field}
          />
        ))}
      </div>

      {canStructure && showManager && (
        <FieldManager entityType={entityType} entityId={entityId} />
      )}
    </section>
  );
}

/** One typed input bound to a field's current value. All roles (data op). */
function FieldValueRow({
  entityType,
  entityId,
  field,
}: {
  entityType: EntityType;
  entityId: string;
  field: FieldValue;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(field.value ?? "");
  const set = trpc.customFields.setValue.useMutation({
    onSuccess: () => utils.customFields.listValuesForEntity.invalidate({ entityType, entityId }),
  });
  const save = (value: string | null) =>
    set.mutate({ customFieldId: field.fieldId, entityType, entityId, value });

  const label = (
    <label style={{ minWidth: "8rem" }}>
      {field.name}
      {field.isRequired && <span style={warn}> *</span>}
    </label>
  );

  // boolean + select save immediately on change (values are always valid).
  if (field.fieldType === "boolean") {
    return (
      <div style={rowStyle}>
        {label}
        <select
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value || null);
          }}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        {set.error && <span style={warn}>{set.error.message}</span>}
      </div>
    );
  }

  if (field.fieldType === "select") {
    return (
      <div style={rowStyle}>
        {label}
        <select
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value || null);
          }}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {set.error && <span style={warn}>{set.error.message}</span>}
      </div>
    );
  }

  const inputType =
    field.fieldType === "number"
      ? "number"
      : field.fieldType === "date"
        ? "date"
        : field.fieldType === "url"
          ? "url"
          : "text";

  return (
    <div style={rowStyle}>
      {label}
      <input type={inputType} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button
        type="button"
        disabled={set.isPending}
        onClick={() => save(draft.trim() === "" ? null : draft)}
      >
        Save
      </button>
      <button
        type="button"
        disabled={set.isPending}
        onClick={() => {
          setDraft("");
          save(null);
        }}
      >
        Clear
      </button>
      {set.error && <span style={warn}>{set.error.message}</span>}
    </div>
  );
}

/** Owner/admin field definition management (create / delete). */
function FieldManager({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const utils = trpc.useUtils();
  const fields = trpc.customFields.listForEntityType.useQuery({ entityType });

  // Creating/deleting a definition changes the value form above too.
  const invalidate = () =>
    Promise.all([
      utils.customFields.listForEntityType.invalidate({ entityType }),
      utils.customFields.listValuesForEntity.invalidate({ entityType, entityId }),
    ]);

  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [options, setOptions] = useState(""); // comma-separated, for select
  const [isRequired, setIsRequired] = useState(false);

  const create = trpc.customFields.create.useMutation({
    onSuccess: async () => {
      await invalidate();
      setName("");
      setOptions("");
      setIsRequired(false);
    },
  });

  const submit = () =>
    create.mutate({
      entityType,
      name,
      fieldType,
      isRequired,
      sortOrder: 0,
      ...(fieldType === "select"
        ? { options: options.split(",").map((s) => s.trim()).filter(Boolean) }
        : {}),
    });

  return (
    <div style={{ marginTop: "1rem", border: "1px solid #333", borderRadius: 6, padding: "0.75rem" }}>
      <p style={{ ...muted, marginTop: 0 }}>Manage field definitions (owner/admin)</p>

      <div style={{ ...rowStyle, marginBottom: "0.5rem" }}>
        <input placeholder="Field name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)}>
          {fieldTypeValues.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {fieldType === "select" && (
          <input
            placeholder="options, comma-separated"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        )}
        <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
          Required
        </label>
        <button type="button" disabled={create.isPending || name.trim() === ""} onClick={submit}>
          {create.isPending ? "Adding…" : "Add field"}
        </button>
      </div>
      {create.error && <p style={warn}>{create.error.message}</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.4rem" }}>
        {(fields.data ?? []).map((f) => (
          <FieldManagerRow key={f.id} field={f} onChanged={invalidate} />
        ))}
      </ul>
    </div>
  );
}

function FieldManagerRow({
  field,
  onChanged,
}: {
  field: { id: string; name: string; fieldType: string };
  onChanged: () => Promise<unknown> | void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = trpc.customFields.delete.useMutation({ onSuccess: onChanged });

  return (
    <li style={rowStyle}>
      <span style={{ minWidth: "10rem" }}>
        {field.name} <span style={muted}>({field.fieldType})</span>
      </span>
      {confirmDelete ? (
        <>
          <button type="button" disabled={del.isPending} onClick={() => del.mutate({ id: field.id })}>
            {del.isPending ? "Deleting…" : "Confirm (deletes all its values)"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      )}
      {del.error && <span style={warn}>{del.error.message}</span>}
    </li>
  );
}
