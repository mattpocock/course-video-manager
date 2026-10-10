import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildReadLayer,
  makeReadRun,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// An id from an OLDER Course Version resolves to the Draft's equivalent.
//
// Submit copies the Draft into a fresh Draft with fresh ids, so a stored
// Section, Lesson or Video id goes stale with every Course Version. Every copy
// keeps its `lineageId`, and a Discarded Pending Version's ids survive only
// in the copy's `previousVersionSectionId` / `previousVersionLessonId`. Any
// command taking one of these ids resolves it (resolveDraftId), and the
// stable `lineageId` is accepted wherever the id is.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
});

let seed: {
  draftSectionId: string;
  draftSectionLineageId: string;
  draftLessonId: string;
  lineageDraftSectionId: string;
  publishedSectionId: string;
  orphanSectionId: string;
  publishedVideoId: string;
  draftVideoId: string;
  draftVideoLineageId: string;
};

beforeEach(async () => {
  await truncateAllTables(testDb);

  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Alpha" })
    .returning();
  const [published] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "v1",
      commitState: "published",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    })
    .returning();
  const [draft] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "",
      commitState: "draft",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();

  // The Draft's copy of a Section whose previous version was Discarded: its
  // previous-version link points at a row that no longer exists.
  const [draftSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: draft!.id,
      previousVersionSectionId: "section-from-discarded-version",
      title: "intro",
      order: 1,
    })
    .returning();
  const [draftLesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      previousVersionLessonId: "lesson-from-discarded-version",
      title: "welcome",
      order: 1,
    })
    .returning();

  // A broken chain: the old id lives on in the PUBLISHED version, but the link
  // from there to the Draft went through a deleted version. lineageId — which
  // every copy carries unchanged — still finds the Draft's copy.
  const [publishedSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: published!.id,
      previousVersionSectionId: "section-from-before-v1",
      title: "basics",
      order: 1,
    })
    .returning();
  const [lineageDraftSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: draft!.id,
      previousVersionSectionId: "section-in-deleted-pending",
      lineageId: publishedSection!.lineageId,
      title: "basics",
      order: 2,
    })
    .returning();

  // A Section that never made it into the Draft: no copy of its lineage.
  const [orphanSection] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: published!.id, title: "gone", order: 2 })
    .returning();

  // A Video copied forward by Submit: fresh id, same lineage.
  const [publishedLesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: publishedSection!.id, title: "old", order: 1 })
    .returning();
  const [publishedVideo] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: publishedLesson!.id,
      title: "take",
      originalFootagePath: "",
    })
    .returning();
  const [draftVideo] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: draftLesson!.id,
      lineageId: publishedVideo!.lineageId,
      title: "take",
      originalFootagePath: "",
    })
    .returning();

  seed = {
    draftSectionId: draftSection!.id,
    draftSectionLineageId: draftSection!.lineageId,
    draftLessonId: draftLesson!.id,
    lineageDraftSectionId: lineageDraftSection!.id,
    publishedSectionId: publishedSection!.id,
    orphanSectionId: orphanSection!.id,
    publishedVideoId: publishedVideo!.id,
    draftVideoId: draftVideo!.id,
    draftVideoLineageId: draftVideo!.lineageId,
  };
});

describe("ids from an older Course Version", () => {
  it("section get resolves a Discarded version's id, with a note", async () => {
    const res = await run(["section", "get", "section-from-discarded-version"]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).id).toBe(seed.draftSectionId);
    expect(res.stderr).toMatch(/^note: .*older Course Version/);
    expect(res.stderr).toContain(seed.draftSectionId);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("resolves a Published Section's id by lineage, and writes go to the Draft", async () => {
    const res = await run([
      "section",
      "rename",
      "--title",
      "renamed",
      seed.publishedSectionId,
    ]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).id).toBe(seed.lineageDraftSectionId);
    expect(res.stderr).toContain(seed.lineageDraftSectionId);
    const published = await testDb.query.sections.findFirst({
      where: (s, { eq }) => eq(s.id, seed.publishedSectionId),
    });
    expect(published!.title).toBe("basics");
  });

  it("lesson get resolves a stale lesson id", async () => {
    const res = await run(["lesson", "get", "lesson-from-discarded-version"]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).id).toBe(seed.draftLessonId);
    expect(res.stderr).toContain(seed.draftLessonId);
  });

  it("an option resolves too (lesson list --section)", async () => {
    const res = await run([
      "lesson",
      "list",
      "--section",
      "section-from-discarded-version",
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(seed.draftLessonId);
  });

  it("video get resolves an older version's video id by lineage", async () => {
    const res = await run(["video", "get", seed.publishedVideoId]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).id).toBe(seed.draftVideoId);
    expect(res.stderr).toContain(seed.draftVideoId);
  });

  it("errors, naming its latest copy, when the Draft has no copy of the lineage", async () => {
    const res = await run(["section", "tree", seed.orphanSectionId]);

    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err).toMatchObject({ _tag: "NotFoundError", entity: "section" });
    expect(err.message).toContain("the current Draft has no copy");
  });

  it("an id nothing descends from stays a bare NotFoundError", async () => {
    const res = await run(["section", "get", "never-existed"]);

    expect(res.exitCode).toBe(2);
    const err = JSON.parse(res.stderr);
    expect(err).toEqual({
      _tag: "NotFoundError",
      entity: "section",
      id: "never-existed",
    });
  });
});

describe("the stable lineageId", () => {
  it("section list shows it, and get resolves it silently", async () => {
    const [course] = await testDb.query.courses.findMany();
    const listed = res(
      await run(["section", "list", "--course", course!.id])
    ).find((s) => s.id === seed.draftSectionId);
    expect(listed!.lineageId).toBe(seed.draftSectionLineageId);

    const got = await run(["section", "get", seed.draftSectionLineageId]);
    expect(got.exitCode).toBe(0);
    expect(JSON.parse(got.stdout).id).toBe(seed.draftSectionId);
    expect(got.stderr).toBe("");
  });

  it("is accepted for a Video, and video get shows it", async () => {
    const got = await run(["video", "get", seed.draftVideoLineageId]);
    expect(got.exitCode).toBe(0);
    expect(JSON.parse(got.stdout)).toMatchObject({
      id: seed.draftVideoId,
      lineageId: seed.draftVideoLineageId,
    });
  });
});

const res = (r: RunResult) =>
  r.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { id: string; lineageId: string });
