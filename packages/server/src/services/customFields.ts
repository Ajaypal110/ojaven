import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { customFields, customFieldValues, db } from "@ojaven/db";
import type {
  CreateCustomFieldInput,
  EntityType,
  FieldType,
  SetFieldValueInput,
  UpdateCustomFieldInput,
} from "@ojaven/shared";
import { assertEntityLive, assertSupportedEntityType } from "./entityRef";

const badValue = (expected: string) =>
  new TRPCError({ code: "BAD_REQUEST", message: `Enter ${expected}.` });

/**
 * Validate + canonicalize a raw string value against the field's type. Dynamic
 * (depends on the field row), which is why it can't live in Zod. Returns the
 * canonical string to store; throws BAD_REQUEST otherwise. Clearing (null) is
 * handled by the caller before this runs.
 */
export function validateFieldValue(
  fieldType: FieldType,
  options: string[] | null,
  raw: string
): string {
  const value = raw.trim();
  switch (fieldType) {
    case "text":
      return value;
    case "number": {
      if (value === "" || !Number.isFinite(Number(value))) throw badValue("a number");
      return String(Number(value)); // canonical (e.g. "12.50" -> "12.5")
    }
    case "boolean": {
      if (value !== "true" && value !== "false") throw badValue('"true" or "false"');
      return value;
    }
    case "date": {
      // Calendar date, matching the DB `date` columns used elsewhere.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
        throw badValue("a date (YYYY-MM-DD)");
      return value;
    }
    case "url": {
      try {
        new URL(value);
      } catch {
        throw badValue("a valid URL (https://…)");
      }
      return value;
    }
    case "select": {
      if (!options || !options.includes(value)) throw badValue("one of the field's options");
      return value;
    }
  }
}

/** All custom-field definitions for an entity type, in display order. */
export function listCustomFields(params: { agencyId: string; entityType: EntityType }) {
  assertSupportedEntityType(params.entityType);
  return db
    .select()
    .from(customFields)
    .where(
      and(eq(customFields.agencyId, params.agencyId), eq(customFields.entityType, params.entityType))
    )
    .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
}

export async function createCustomField(params: {
  agencyId: string;
  input: CreateCustomFieldInput;
}) {
  const { agencyId, input } = params;
  assertSupportedEntityType(input.entityType);
  // options are meaningful only for select; store null otherwise. The Zod
  // refine already guarantees a select has a non-empty options array.
  const options = input.fieldType === "select" ? (input.options ?? []) : null;
  const [row] = await db
    .insert(customFields)
    .values({
      agencyId,
      entityType: input.entityType,
      name: input.name,
      fieldType: input.fieldType,
      options,
      isRequired: input.isRequired,
      sortOrder: input.sortOrder,
    })
    .returning();
  return row;
}

/**
 * Update a definition. entityType + fieldType are immutable (not in the
 * schema) — retyping would corrupt stored values. options are only writable on
 * a select field, and a select can't be emptied.
 */
export async function updateCustomField(params: {
  agencyId: string;
  id: string;
  input: Omit<UpdateCustomFieldInput, "id">;
}) {
  const { agencyId, id, input } = params;

  const [field] = await db
    .select({ fieldType: customFields.fieldType })
    .from(customFields)
    .where(and(eq(customFields.id, id), eq(customFields.agencyId, agencyId)))
    .limit(1);
  if (!field) throw new TRPCError({ code: "NOT_FOUND", message: "Custom field not found." });

  const set: Partial<typeof customFields.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.isRequired !== undefined) set.isRequired = input.isRequired;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  if (input.options !== undefined && field.fieldType === "select") {
    if (input.options.length === 0) throw badValue("at least one option for a select field");
    set.options = input.options;
  }

  if (Object.keys(set).length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to update." });
  }

  const [row] = await db
    .update(customFields)
    .set(set)
    .where(and(eq(customFields.id, id), eq(customFields.agencyId, agencyId)))
    .returning();
  return row;
}

/** Hard delete — cascades customFieldValues via FK. */
export async function deleteCustomField(params: { agencyId: string; id: string }) {
  const [row] = await db
    .delete(customFields)
    .where(and(eq(customFields.id, params.id), eq(customFields.agencyId, params.agencyId)))
    .returning({ id: customFields.id });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Custom field not found." });
  return row;
}

/**
 * Set (or clear) a field's value on an entity. Loads the field def, checks its
 * entityType matches the target, runs assertEntityLive (the sole tenant guard),
 * validates the value against the field type, then upserts on
 * (customFieldId, entityId). value=null clears — the row is deleted, so absence
 * means "unset".
 */
export async function setFieldValue(params: { agencyId: string; input: SetFieldValueInput }) {
  const { agencyId, input } = params;

  const [field] = await db
    .select()
    .from(customFields)
    .where(and(eq(customFields.id, input.customFieldId), eq(customFields.agencyId, agencyId)))
    .limit(1);
  if (!field) throw new TRPCError({ code: "NOT_FOUND", message: "Custom field not found." });

  if (field.entityType !== input.entityType) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That field doesn't apply to this record." });
  }

  await assertEntityLive(db, agencyId, input.entityType, input.entityId);

  if (input.value === null) {
    await db
      .delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.customFieldId, input.customFieldId),
          eq(customFieldValues.entityId, input.entityId)
        )
      );
    return { cleared: true as const };
  }

  const value = validateFieldValue(field.fieldType, field.options, input.value);

  const [row] = await db
    .insert(customFieldValues)
    .values({
      agencyId,
      customFieldId: input.customFieldId,
      entityType: input.entityType,
      entityId: input.entityId,
      value,
    })
    .onConflictDoUpdate({
      target: [customFieldValues.customFieldId, customFieldValues.entityId],
      // $onUpdate doesn't fire on onConflictDoUpdate, so bump updatedAt here.
      set: { value, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/**
 * Every field definition for the entity's type, left-joined with this entity's
 * value (null when unset) — the shape a form needs. Parent must be live.
 */
export async function listFieldValuesForEntity(params: {
  agencyId: string;
  entityType: EntityType;
  entityId: string;
}) {
  const { agencyId, entityType, entityId } = params;
  await assertEntityLive(db, agencyId, entityType, entityId);
  return db
    .select({
      fieldId: customFields.id,
      name: customFields.name,
      fieldType: customFields.fieldType,
      options: customFields.options,
      isRequired: customFields.isRequired,
      sortOrder: customFields.sortOrder,
      value: customFieldValues.value,
    })
    .from(customFields)
    .leftJoin(
      customFieldValues,
      and(
        eq(customFieldValues.customFieldId, customFields.id),
        eq(customFieldValues.entityId, entityId)
      )
    )
    .where(and(eq(customFields.agencyId, agencyId), eq(customFields.entityType, entityType)))
    .orderBy(asc(customFields.sortOrder), asc(customFields.createdAt));
}
