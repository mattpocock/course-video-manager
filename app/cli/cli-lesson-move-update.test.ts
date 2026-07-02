import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm WRITE verbs — lesson update (rename) + move (reorder / re-home)
//
// All fixtures use a GHOST course (no filePath) with GHOST lessons, so the move
// planner emits zero filesystem ops and the disk-sync validation short-circuits
// (repoPath === null). That exercises the full CLI → CourseWriteService wiring,
// the planner, and the Draft guard as a pure DB path over PGlite. The on-disk
// renumber / git-mv cascade for REAL lessons is covered by the service's own
// suites (lesson-move-planner, course-repo-write-*).
//
// CLI convention: options come BEFORE the positional <id> (a flag after the id
// is rejected), so every invocation below is `move --flag val <id>`.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

interface Lesson {
  id: string;
  sectionId: string;
  title: string;
  path: string;
  order: number;
  fsStatus: string;
  archived: boolean;
}

interface MoveSeed {
  repoId: string;
  draftVersionId: string;
  sectionAId: string;
  sectionBId: string;
  /** An archived (deleted) section in the Draft version. */
  archivedSectionId: string;
  /** A section in the OLDER (frozen) version. */
  oldSectionId: string;
  /** Section A ghost lessons, in seeded order. */
  a1: string;
  a2: string;
  a3: string;
  /** Section B ghost lesson. */
  b1: string;
  /** A lesson living in an OLDER (published/frozen) version. */
  publishedLessonId: string;
}

/** Add a ghost lesson to a section and return its id. */
const addGhost = async (
  db: TestDb,
  sectionId: string,
  path: string,
  title: string,
  order: number
): Promise<string> => {
  const [row] = await db
    .insert(schema.lessons)
    .values({ sectionId, path, title, order, fsStatus: "ghost" })
    .returning();
  return row!.id;
};

/**
 * A ghost course (filePath null) with two sections of ghost lessons, plus an
 * older frozen version carrying one lesson (for the Draft-guard tests). The
 * draft is the NEWER version by createdAt.
 */
const seedMove = async (db: TestDb): Promise<MoveSeed> => {
  const [course] = await db
    .insert(schema.courses)
    .values({ name: "Beta", slug: "beta" }) // no filePath => ghost course
    .returning();

  const [oldVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "v1",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();
  const [draftVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "",
      createdAt: new Date("2024-06-01T00:00:00Z"),
    })
    .returning();

  const [sectionA] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, path: "01-alpha", order: 1 })
    .returning();
  const [sectionB] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, path: "02-beta", order: 2 })
    .returning();

  const a1 = await addGhost(db, sectionA!.id, "a-one", "A One", 1);
  const a2 = await addGhost(db, sectionA!.id, "a-two", "A Two", 2);
  const a3 = await addGhost(db, sectionA!.id, "a-three", "A Three", 3);
  const b1 = await addGhost(db, sectionB!.id, "b-one", "B One", 1);

  const [archivedSection] = await db
    .insert(schema.sections)
    .values({
      repoVersionId: draftVersion!.id,
      path: "03-gone",
      order: 3,
      archivedAt: new Date("2024-05-01T00:00:00Z"),
    })
    .returning();

  const [oldSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: oldVersion!.id, path: "01-old", order: 1 })
    .returning();
  const publishedLessonId = await addGhost(
    db,
    oldSection!.id,
    "old-one",
    "Old One",
    1
  );

  return {
    repoId: course!.id,
    draftVersionId: draftVersion!.id,
    sectionAId: sectionA!.id,
    sectionBId: sectionB!.id,
    archivedSectionId: archivedSection!.id,
    oldSectionId: oldSection!.id,
    a1,
    a2,
    a3,
    b1,
    publishedLessonId,
  };
};

/** Ordered lesson ids in a section (as `lesson list`, which sorts by order). */
const orderOf = async (sectionId: string): Promise<string[]> =>
  (
    ndjson(
      (await run(["lesson", "list", "--section", sectionId])).stdout
    ) as Lesson[]
  ).map((l) => l.id);

let s: MoveSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedMove(testDb);
});

// ---------------------------------------------------------------------------
// update (rename)
// ---------------------------------------------------------------------------

describe("lesson update --title", () => {
  it("renames the title, leaves the slug/path untouched, echoes the lesson", async () => {
    const { stdout, stderr, exitCode } = await run([
      "lesson",
      "update",
      "--title",
      "A Much Better Title",
      s.a1,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/); // single pretty object
    const lesson = one<Lesson>(stdout);
    expect(lesson.title).toBe("A Much Better Title");
    expect(lesson.path).toBe("a-one"); // slug is deliberately NOT re-derived
  });

  it("rejects an empty title as invalid input (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "update",
      "--title",
      "   ",
      s.a1,
    ]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("ParseError");
  });

  it("reports a missing lesson as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "lesson",
      "update",
      "--title",
      "X",
      "les_missing",
    ]);
    expect(exitCode).toBe(2);
  });

  it("refuses to edit a lesson in a published version (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "update",
      "--title",
      "Nope",
      s.publishedLessonId,
    ]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("ParseError");
  });
});

// ---------------------------------------------------------------------------
// move — same-section reorder
// ---------------------------------------------------------------------------

describe("lesson move (same-section reorder)", () => {
  it("--before puts the lesson immediately before the anchor", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--before",
      s.a1,
      s.a3,
    ]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.sectionAId)).toEqual([s.a3, s.a1, s.a2]);
  });

  it("--after puts the lesson immediately after the anchor", async () => {
    const { exitCode } = await run(["lesson", "move", "--after", s.a3, s.a1]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.sectionAId)).toEqual([s.a2, s.a3, s.a1]);
  });

  it("no anchor appends to the end of the section", async () => {
    const { exitCode } = await run(["lesson", "move", s.a1]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.sectionAId)).toEqual([s.a2, s.a3, s.a1]);
  });

  it("rejects moving a lesson relative to itself (exit 3)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--before",
      s.a1,
      s.a1,
    ]);
    expect(exitCode).toBe(3);
  });

  it("rejects both --before and --after (exit 3)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--before",
      s.a2,
      "--after",
      s.a3,
      s.a1,
    ]);
    expect(exitCode).toBe(3);
  });

  it("reports an anchor that is not a sibling as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--before",
      s.b1, // in section B, not a sibling of a1
      s.a1,
    ]);
    expect(exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// move — cross-section re-home
// ---------------------------------------------------------------------------

describe("lesson move (cross-section)", () => {
  it("--section appends the lesson to the destination and removes it from the source", async () => {
    const { stdout, exitCode } = await run([
      "lesson",
      "move",
      "--section",
      s.sectionBId,
      s.a1,
    ]);
    expect(exitCode).toBe(0);
    const moved = one<{ section: { id: string } }>(stdout);
    expect(moved.section.id).toBe(s.sectionBId);
    expect(await orderOf(s.sectionAId)).toEqual([s.a2, s.a3]);
    expect(await orderOf(s.sectionBId)).toEqual([s.b1, s.a1]);
  });

  it("--section with --before positions the lesson at the anchor", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--section",
      s.sectionBId,
      "--before",
      s.b1,
      s.a1,
    ]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.sectionBId)).toEqual([s.a1, s.b1]);
  });

  it("--section with --after positions the lesson after the anchor", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--section",
      s.sectionBId,
      "--after",
      s.b1,
      s.a1,
    ]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.sectionBId)).toEqual([s.b1, s.a1]);
  });

  it("reports a missing destination section as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--section",
      "sec_missing",
      s.a1,
    ]);
    expect(exitCode).toBe(2);
  });

  it("reports an archived destination section as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--section",
      s.archivedSectionId,
      s.a1,
    ]);
    expect(exitCode).toBe(2);
    // and the lesson must NOT have moved.
    expect(await orderOf(s.sectionAId)).toEqual([s.a1, s.a2, s.a3]);
  });

  it("reports a destination section in another version as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "lesson",
      "move",
      "--section",
      s.oldSectionId, // exists, but in the frozen older version
      s.a1,
    ]);
    expect(exitCode).toBe(2);
    expect(await orderOf(s.sectionAId)).toEqual([s.a1, s.a2, s.a3]);
  });

  it("refuses to move a lesson in a published version (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "move",
      s.publishedLessonId, // lives in the older, frozen version
    ]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("ParseError");
  });
});
