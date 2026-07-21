import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { db, entityTags, tags } from "@ojaven/db";
import type { CreateTagInput, EntityType, TagAttachmentInput, UpdateTagInput } from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505"
  );
}

const nameTaken = () =>
  new TRPCError({ code: "CONFLICT", message: "A tag with that name already exists." });

/** All tag definitions for the agency, alphabetical. */
export function listTags(agencyId: string) {
  return db.select().from(tags).where(eq(tags.agencyId, agencyId)).orderBy(asc(tags.name));
}

export async function createTag(params: { agencyId: string; input: CreateTagInput }) {
  const { agencyId, input } = params;
  try {
    const [row] = await db
      .insert(tags)
      .values({ agencyId, name: input.name, color: input.color || null })
      .returning();
    return row;
  } catch (err) {
    // UNIQUE(agencyId, name) — the constraint is the serialization; no lock
    // needed for a straight unique insert, just a readable translation.
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function updateTag(params: {
  agencyId: string;
  id: string;
  input: Omit<UpdateTagInput, "id">;
}) {
  const { agencyId, id, input } = params;
  const set: Partial<typeof tags.$inferInsert> = { name: input.name };
  if (input.color !== undefined) set.color = input.color || null; // "" clears
  try {
    const [row] = await db
      .update(tags)
      .set(set)
      .where(and(eq(tags.id, id), eq(tags.agencyId, agencyId)))
      .returning();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

/** Hard delete — cascades entityTags via FK (config primitive, not recoverable). */
export async function deleteTag(params: { agencyId: string; id: string }) {
  const [row] = await db
    .delete(tags)
    .where(and(eq(tags.id, params.id), eq(tags.agencyId, params.agencyId)))
    .returning({ id: tags.id });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });
  return row;
}

/**
 * Attach a tag to an entity. Idempotent (ON CONFLICT DO NOTHING on the
 * (tagId, entityId) unique) — re-attaching an already-attached tag is a no-op
 * success. Both the tag and the target entity are verified agency-owned; the
 * entity check is assertEntityLive, the sole tenant guard for the polymorphic
 * reference.
 */
export async function attachTag(params: { agencyId: string; input: TagAttachmentInput }) {
  const { agencyId, input } = params;

  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, input.tagId), eq(tags.agencyId, agencyId)))
    .limit(1);
  if (!tag) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });

  await assertEntityLive(db, agencyId, input.entityType, input.entityId);

  await db
    .insert(entityTags)
    .values({
      agencyId,
      tagId: input.tagId,
      entityType: input.entityType,
      entityId: input.entityId,
    })
    .onConflictDoNothing({ target: [entityTags.tagId, entityTags.entityId] });

  return { attached: true };
}

/**
 * Detach a tag from an entity. Agency-scoped, idempotent (deleting a
 * non-existent link is a no-op). No liveness check — removing a link is
 * harmless even if the entity was since soft-deleted.
 */
export async function detachTag(params: { agencyId: string; input: TagAttachmentInput }) {
  const { agencyId, input } = params;
  await db
    .delete(entityTags)
    .where(
      and(
        eq(entityTags.agencyId, agencyId),
        eq(entityTags.tagId, input.tagId),
        eq(entityTags.entityId, input.entityId)
      )
    );
  return { detached: true };
}

/** Tags attached to one entity (parent must be live). */
export async function listTagsForEntity(params: {
  agencyId: string;
  entityType: EntityType;
  entityId: string;
}) {
  const { agencyId, entityType, entityId } = params;
  await assertEntityLive(db, agencyId, entityType, entityId);
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      and(
        eq(entityTags.agencyId, agencyId),
        eq(entityTags.entityType, entityType),
        eq(entityTags.entityId, entityId)
      )
    )
    .orderBy(asc(tags.name));
}
