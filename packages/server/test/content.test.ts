import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients, contentItems, db, teamMembers } from "@ojaven/db";
import { assertReviewRole } from "../src/roleGuards";
import {
  createContent,
  deleteContent,
  getContentById,
  listContent,
  publishContent,
  reviewContent,
  submitContent,
  updateContent,
} from "../src/services/content";
import { attachTag, createTag, listTagsForEntity } from "../src/services/tags";
import { addNote, listActivitiesForEntity } from "../src/services/activities";
import { ensureMembership } from "../src/services/teamMembership";
import { cleanupAgencies, cleanupUsers, seedAgency, seedUser } from "./helpers";

const agencyIds: string[] = [];
const userIds: string[] = [];
afterAll(async () => {
  await cleanupAgencies(agencyIds);
  await cleanupUsers(userIds);
});

async function freshAgency() {
  const a = await seedAgency();
  agencyIds.push(a.id);
  return a;
}
/** Member with a specific role (ensureMembership then a direct role write). */
async function memberWithRole(agencyId: string, role: "owner" | "admin" | "manager" | "operator", label = role) {
  const u = await seedUser(label);
  userIds.push(u.id);
  await ensureMembership({ agencyId, userId: u.id });
  await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.agencyId, agencyId), eq(teamMembers.userId, u.id)));
  return u.id;
}
async function seedClient(agencyId: string, name = "Acme Co") {
  const [c] = await db.insert(clients).values({ agencyId, name }).returning();
  return c!;
}
async function draftItem(agencyId: string, clientId: string, actor: string, title = "Post") {
  return createContent({
    agencyId,
    actorUserId: actor,
    input: { clientId, title, body: "Body copy", contentType: "blog" },
  });
}

describe("state machine — the legal path", () => {
  it("draft -> submit -> approve (stamped) -> publish", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const reviewer = await memberWithRole(a.id, "manager", "reviewer");
    const client = await seedClient(a.id);

    const item = await draftItem(a.id, client.id, writer);
    expect(item?.status).toBe("draft");

    const submitted = await submitContent({ agencyId: a.id, id: item!.id });
    expect(submitted.status).toBe("in_review");

    const approved = await reviewContent({
      agencyId: a.id,
      actorUserId: reviewer,
      input: { id: item!.id, decision: "approve" },
    });
    expect(approved.status).toBe("approved");
    expect(approved.reviewedById).toBe(reviewer);
    expect(approved.reviewedAt).not.toBeNull();
    expect(approved.reviewNote).toBeNull(); // note optional

    const published = await publishContent({ agencyId: a.id, id: item!.id });
    expect(published.status).toBe("published");
  });

  it("reject with note -> edit -> resubmit -> approve overwrites the verdict", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const reviewer = await memberWithRole(a.id, "manager", "reviewer");
    const client = await seedClient(a.id);

    const item = await draftItem(a.id, client.id, writer);
    await submitContent({ agencyId: a.id, id: item!.id });
    const rejected = await reviewContent({
      agencyId: a.id,
      actorUserId: reviewer,
      input: { id: item!.id, decision: "reject", note: "Tone is off — rewrite the intro." },
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reviewNote).toBe("Tone is off — rewrite the intro.");

    // Rejected is editable; the stale note survives until the next verdict.
    const edited = await updateContent({
      agencyId: a.id,
      input: { id: item!.id, body: "Rewritten intro." },
    });
    expect(edited.body).toBe("Rewritten intro.");
    expect(edited.reviewNote).toBe("Tone is off — rewrite the intro.");

    await submitContent({ agencyId: a.id, id: item!.id }); // rejected -> in_review
    const approved = await reviewContent({
      agencyId: a.id,
      actorUserId: reviewer,
      input: { id: item!.id, decision: "approve", note: "Much better." },
    });
    expect(approved.status).toBe("approved");
    expect(approved.reviewNote).toBe("Much better."); // overwritten
  });

  it("self-review is permitted (solo agencies must not deadlock)", async () => {
    const a = await freshAgency();
    const solo = await memberWithRole(a.id, "owner", "solo");
    const client = await seedClient(a.id);
    const item = await draftItem(a.id, client.id, solo);
    await submitContent({ agencyId: a.id, id: item!.id });
    const approved = await reviewContent({
      agencyId: a.id,
      actorUserId: solo,
      input: { id: item!.id, decision: "approve" },
    });
    expect(approved.reviewedById).toBe(solo); // creator == reviewer, allowed
  });
});

describe("state machine — every illegal transition", () => {
  it("submit / review / publish each refuse every wrong source state", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const reviewer = await memberWithRole(a.id, "manager", "reviewer");
    const client = await seedClient(a.id);

    // Build one item in each state.
    const mk = () => draftItem(a.id, client.id, writer);
    const draft = await mk();
    const inReview = await mk();
    await submitContent({ agencyId: a.id, id: inReview!.id });
    const approved = await mk();
    await submitContent({ agencyId: a.id, id: approved!.id });
    await reviewContent({ agencyId: a.id, actorUserId: reviewer, input: { id: approved!.id, decision: "approve" } });
    const published = await mk();
    await submitContent({ agencyId: a.id, id: published!.id });
    await reviewContent({ agencyId: a.id, actorUserId: reviewer, input: { id: published!.id, decision: "approve" } });
    await publishContent({ agencyId: a.id, id: published!.id });

    // submit: only draft|rejected.
    for (const bad of [inReview, approved, published]) {
      await expect(submitContent({ agencyId: a.id, id: bad!.id })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    // review: only in_review.
    for (const bad of [draft, approved, published]) {
      await expect(
        reviewContent({ agencyId: a.id, actorUserId: reviewer, input: { id: bad!.id, decision: "approve" } })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    // publish: only approved.
    for (const bad of [draft, inReview, published]) {
      await expect(publishContent({ agencyId: a.id, id: bad!.id })).rejects.toMatchObject({ code: "CONFLICT" });
    }
  });

  it("edit locks: in_review, approved, and published all refuse edits", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const reviewer = await memberWithRole(a.id, "manager", "reviewer");
    const client = await seedClient(a.id);

    const item = await draftItem(a.id, client.id, writer);
    await submitContent({ agencyId: a.id, id: item!.id });
    await expect(
      updateContent({ agencyId: a.id, input: { id: item!.id, title: "sneaky" } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await reviewContent({ agencyId: a.id, actorUserId: reviewer, input: { id: item!.id, decision: "approve" } });
    await expect(
      updateContent({ agencyId: a.id, input: { id: item!.id, title: "sneaky" } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await publishContent({ agencyId: a.id, id: item!.id });
    await expect(
      updateContent({ agencyId: a.id, input: { id: item!.id, title: "sneaky" } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, item!.id));
    expect(row?.title).toBe("Post"); // untouched through all three attempts
  });
});

describe("the manager+ review gate (all four roles)", () => {
  it("owner, admin, manager pass; operator is refused", () => {
    expect(() => assertReviewRole("owner", "content")).not.toThrow();
    expect(() => assertReviewRole("admin", "content")).not.toThrow();
    expect(() => assertReviewRole("manager", "content")).not.toThrow();
    expect(() => assertReviewRole("operator", "content")).toThrow(/Only managers and above/);
  });
});

describe("content_item joins the polymorphic guard (tags + timeline)", () => {
  it("tags attach and the activity timeline works on live content", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const client = await seedClient(a.id);
    const item = await draftItem(a.id, client.id, writer);
    const tag = await createTag({ agencyId: a.id, input: { name: "Q3-campaign" } });

    await attachTag({
      agencyId: a.id,
      input: { tagId: tag!.id, entityType: "content_item", entityId: item!.id },
    });
    const tags = await listTagsForEntity({ agencyId: a.id, entityType: "content_item", entityId: item!.id });
    expect(tags.map((t) => t.name)).toEqual(["Q3-campaign"]);

    await addNote({
      agencyId: a.id,
      authorId: writer,
      entityType: "content_item",
      entityId: item!.id,
      body: "First pass of the intro is up for feedback.",
    });
    const timeline = await listActivitiesForEntity({ agencyId: a.id, entityType: "content_item", entityId: item!.id });
    expect(timeline[0]?.body).toContain("First pass");
  });

  it("liveness chains: cross-agency, soft-deleted item, and dead parent client all NOT_FOUND", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const client = await seedClient(a.id);
    const item = await draftItem(a.id, client.id, writer);
    const tag = await createTag({ agencyId: b.id, input: { name: "b-tag" } });

    // Agency B can't tag A's content.
    await expect(
      attachTag({ agencyId: b.id, input: { tagId: tag!.id, entityType: "content_item", entityId: item!.id } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Soft-deleted content is unreachable.
    const gone = await draftItem(a.id, client.id, writer, "Gone");
    await deleteContent({ agencyId: a.id, id: gone!.id });
    const aTag = await createTag({ agencyId: a.id, input: { name: "a-tag" } });
    await expect(
      attachTag({ agencyId: a.id, input: { tagId: aTag!.id, entityType: "content_item", entityId: gone!.id } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Parent client soft-deleted -> content unreachable.
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, client.id));
    await expect(
      attachTag({ agencyId: a.id, input: { tagId: aTag!.id, entityType: "content_item", entityId: item!.id } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("guards + filters", () => {
  it("create refuses soft-deleted and cross-agency clients", async () => {
    const a = await freshAgency();
    const b = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");

    const dead = await seedClient(a.id);
    await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, dead.id));
    await expect(draftItem(a.id, dead.id, writer)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const bClient = await seedClient(b.id);
    await expect(draftItem(a.id, bClient.id, writer)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters by client, status, and contentType; soft-deleted excluded", async () => {
    const a = await freshAgency();
    const writer = await memberWithRole(a.id, "operator", "writer");
    const client = await seedClient(a.id);

    const blog = await draftItem(a.id, client.id, writer, "Blog A");
    const [ad] = [
      await createContent({
        agencyId: a.id,
        actorUserId: writer,
        input: { clientId: client.id, title: "Ad B", contentType: "ad" },
      }),
    ];
    await submitContent({ agencyId: a.id, id: ad!.id });
    const trashed = await draftItem(a.id, client.id, writer, "Trash");
    await deleteContent({ agencyId: a.id, id: trashed!.id });

    const inReview = await listContent({ agencyId: a.id, status: "in_review" });
    expect(inReview.map((c) => c.title)).toEqual(["Ad B"]);

    const blogs = await listContent({ agencyId: a.id, contentType: "blog" });
    expect(blogs.map((c) => c.title)).toEqual(["Blog A"]);
    expect(blogs.find((c) => c.title === "Trash")).toBeUndefined();

    const byId = await getContentById({ agencyId: a.id, id: blog!.id });
    expect(byId.title).toBe("Blog A");
  });
});
