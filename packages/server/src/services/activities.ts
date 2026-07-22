import { and, desc, eq } from "drizzle-orm";
import { activities, db, users } from "@ojaven/db";
import type { EntityType } from "@ojaven/shared";
import { assertEntityLive } from "./entityRef";

/**
 * An entity's timeline, newest first, with author identity joined in.
 * assertEntityLive is a READ guard here: the timeline of a soft-deleted or
 * cross-agency entity is unreachable, consistent with the entity's own detail
 * page 404ing.
 */
export async function listActivitiesForEntity(params: {
  agencyId: string;
  entityType: EntityType;
  entityId: string;
}) {
  const { agencyId, entityType, entityId } = params;
  await assertEntityLive(db, agencyId, entityType, entityId);
  return db
    .select({
      id: activities.id,
      type: activities.type,
      body: activities.body,
      occurredAt: activities.occurredAt,
      authorId: activities.authorId,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorEmail: users.email,
      authorImageUrl: users.imageUrl,
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.authorId))
    .where(
      and(
        eq(activities.agencyId, agencyId),
        eq(activities.entityType, entityType),
        eq(activities.entityId, entityId)
      )
    )
    .orderBy(desc(activities.occurredAt));
}

/** Append a manual note to an entity's timeline (type fixed to "note"). */
export async function addNote(params: {
  agencyId: string;
  authorId: string;
  entityType: EntityType;
  entityId: string;
  body: string;
}) {
  const { agencyId, authorId, entityType, entityId, body } = params;
  await assertEntityLive(db, agencyId, entityType, entityId);
  const [row] = await db
    .insert(activities)
    .values({ agencyId, entityType, entityId, type: "note", authorId, body })
    .returning();
  return row;
}
