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
// cvm WRITE verbs — section create / rename / move / archive
//
// Mirrors cli-lesson-move-update.test.ts's shape: the REAL CLI, over HTTP, on
// a PGlite-backed remote app — CLI parsing, the RPC client, HTTP, the Draft
// guard, all exercised end to end. Section's own primitive-level coverage
// (createSections, batchUpdateSectionOrders, ...) lives in
// packages/core/services/course-write-section-ops.test.ts; this suite is about
// the CLI's own order math and not-found/draft-guard wiring, same as
// cli-lesson-move-update.test.ts is for lessons.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

interface Section {
  id: string;
  repoVersionId: string;
  title: string;
  order: number;
  archivedAt: string | null;
}

interface SectionSeed {
  courseId: string;
  draftVersionId: string;
  /** An OLDER (frozen/published) version, for the Draft-guard tests. */
  publishedVersionId: string;
  /** Sections in the Draft version, seeded order. */
  sec1: string;
  sec2: string;
  sec3: string;
  /** An already-archived section in the Draft version. */
  archivedSectionId: string;
  /** A section in an OLDER (frozen/published) version. */
  publishedSectionId: string;
}

const seedSections = async (db: TestDb): Promise<SectionSeed> => {
  const [course] = await db
    .insert(schema.courses)
    .values({ name: "Gamma", slug: "gamma" })
    .returning();

  const [oldVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "v1",
      commitState: "published",
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

  const [sec1] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, title: "01-alpha", order: 1 })
    .returning();
  const [sec2] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, title: "02-beta", order: 2 })
    .returning();
  const [sec3] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, title: "03-gamma", order: 3 })
    .returning();

  const [archivedSection] = await db
    .insert(schema.sections)
    .values({
      repoVersionId: draftVersion!.id,
      title: "04-gone",
      order: 4,
      archivedAt: new Date("2024-05-01T00:00:00Z"),
    })
    .returning();

  const [oldSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: oldVersion!.id, title: "01-old", order: 1 })
    .returning();

  return {
    courseId: course!.id,
    draftVersionId: draftVersion!.id,
    publishedVersionId: oldVersion!.id,
    sec1: sec1!.id,
    sec2: sec2!.id,
    sec3: sec3!.id,
    archivedSectionId: archivedSection!.id,
    publishedSectionId: oldSection!.id,
  };
};

/** Ordered section ids of a Version (as `section list`, sorted by order). */
const orderOf = async (repoVersionId: string): Promise<string[]> =>
  (
    ndjson(
      (await run(["section", "list", "--course-version", repoVersionId])).stdout
    ) as Section[]
  ).map((s) => s.id);

let s: SectionSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedSections(testDb);
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("section create", () => {
  it("creates a section appended to the Version, echoing the row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "section",
      "create",
      "--course",
      s.courseId,
      "--title",
      "New Section",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/); // single pretty object, not NDJSON
    const section = one<Section>(stdout);
    expect(section.repoVersionId).toBe(s.draftVersionId);
    expect(section.title).toBe("New Section");
    expect(section.order).toBeGreaterThan(3); // appended after the seed sections
    expect(await orderOf(s.draftVersionId)).toEqual([
      s.sec1,
      s.sec2,
      s.sec3,
      section.id,
    ]);
  });

  it("--course-version pins the same Draft version explicitly", async () => {
    const { exitCode, stdout } = await run([
      "section",
      "create",
      "--course-version",
      s.draftVersionId,
      "--title",
      "Pinned",
    ]);
    expect(exitCode).toBe(0);
    expect(one<Section>(stdout).repoVersionId).toBe(s.draftVersionId);
  });

  it("--before places the new section before the anchor", async () => {
    const before = one<Section>(
      (
        await run([
          "section",
          "create",
          "--course",
          s.courseId,
          "--title",
          "Goes First",
          "--before",
          s.sec2,
        ])
      ).stdout
    );
    const ids = await orderOf(s.draftVersionId);
    expect(ids.indexOf(before.id)).toBeLessThan(ids.indexOf(s.sec2));
    expect(ids).toEqual([s.sec1, before.id, s.sec2, s.sec3]);
  });

  it("--after places the new section after the anchor", async () => {
    const after = one<Section>(
      (
        await run([
          "section",
          "create",
          "--course",
          s.courseId,
          "--title",
          "Goes After",
          "--after",
          s.sec1,
        ])
      ).stdout
    );
    const ids = await orderOf(s.draftVersionId);
    expect(ids).toEqual([s.sec1, after.id, s.sec2, s.sec3]);
  });

  it("both --before and --after => invalid input, exit 3", async () => {
    const { exitCode, stdout, stderr } = await run([
      "section",
      "create",
      "--course",
      s.courseId,
      "--title",
      "X",
      "--before",
      s.sec1,
      "--after",
      s.sec1,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("neither --course nor --course-version => invalid input, exit 3", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "create",
      "--title",
      "X",
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("unknown anchor => NotFoundError(section), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "create",
      "--course",
      s.courseId,
      "--title",
      "X",
      "--before",
      "sec_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "section"
    );
  });

  it("creating in a published version is refused, exit 3", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "create",
      "--course-version",
      s.publishedVersionId,
      "--title",
      "X",
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });
});

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

describe("section rename", () => {
  it("renames the title, echoes the section", async () => {
    const { stdout, stderr, exitCode } = await run([
      "section",
      "rename",
      "--title",
      "A Much Better Title",
      s.sec1,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/);
    const section = one<Section>(stdout);
    expect(section.id).toBe(s.sec1);
    expect(section.title).toBe("A Much Better Title");
  });

  it("rejects an empty title as invalid input (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "rename",
      "--title",
      "   ",
      s.sec1,
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("reports a missing section as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "section",
      "rename",
      "--title",
      "X",
      "sec_missing",
    ]);
    expect(exitCode).toBe(2);
  });

  it("reports an already-archived section as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "section",
      "rename",
      "--title",
      "X",
      s.archivedSectionId,
    ]);
    expect(exitCode).toBe(2);
  });

  it("refuses to rename a section in a published version (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "rename",
      "--title",
      "Nope",
      s.publishedSectionId,
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("renaming to end in ARCHIVE does not soft-delete the section", async () => {
    const { exitCode, stdout } = await run([
      "section",
      "rename",
      "--title",
      "99-ARCHIVE",
      s.sec1,
    ]);
    expect(exitCode).toBe(0);
    expect(one<Section>(stdout).archivedAt).toBeNull();
    // still fully readable and addressable — not the same thing as `archive`.
    const get = await run(["section", "get", s.sec1]);
    expect(get.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("section move", () => {
  it("--before puts the section immediately before the anchor", async () => {
    const { exitCode } = await run([
      "section",
      "move",
      "--before",
      s.sec1,
      s.sec3,
    ]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.draftVersionId)).toEqual([s.sec3, s.sec1, s.sec2]);
  });

  it("--after puts the section immediately after the anchor", async () => {
    const { exitCode } = await run([
      "section",
      "move",
      "--after",
      s.sec3,
      s.sec1,
    ]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.draftVersionId)).toEqual([s.sec2, s.sec3, s.sec1]);
  });

  it("no anchor appends to the end of the Version", async () => {
    const { exitCode } = await run(["section", "move", s.sec1]);
    expect(exitCode).toBe(0);
    expect(await orderOf(s.draftVersionId)).toEqual([s.sec2, s.sec3, s.sec1]);
  });

  it("echoes the moved section with its Version/Course hierarchy", async () => {
    const { stdout } = await run([
      "section",
      "move",
      "--after",
      s.sec3,
      s.sec1,
    ]);
    const moved = one<{ id: string; repoVersion: { id: string } }>(stdout);
    expect(moved.id).toBe(s.sec1);
    expect(moved.repoVersion.id).toBe(s.draftVersionId);
  });

  it("rejects moving a section relative to itself (exit 3)", async () => {
    const { exitCode } = await run([
      "section",
      "move",
      "--before",
      s.sec1,
      s.sec1,
    ]);
    expect(exitCode).toBe(3);
  });

  it("rejects both --before and --after (exit 3)", async () => {
    const { exitCode } = await run([
      "section",
      "move",
      "--before",
      s.sec2,
      "--after",
      s.sec3,
      s.sec1,
    ]);
    expect(exitCode).toBe(3);
  });

  it("reports an anchor from another version as not-found (exit 2)", async () => {
    const { exitCode } = await run([
      "section",
      "move",
      "--before",
      s.publishedSectionId,
      s.sec1,
    ]);
    expect(exitCode).toBe(2);
    expect(await orderOf(s.draftVersionId)).toEqual([s.sec1, s.sec2, s.sec3]);
  });

  it("reports a missing section as not-found (exit 2)", async () => {
    const { exitCode } = await run(["section", "move", "sec_missing"]);
    expect(exitCode).toBe(2);
  });

  it("refuses to move a section in a published version (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "move",
      s.publishedSectionId,
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });
});

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

describe("section archive", () => {
  it("archives the section, echoing archivedAt set, then it disappears", async () => {
    const { stdout, stderr, exitCode } = await run([
      "section",
      "archive",
      s.sec1,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const archived = one<Section>(stdout);
    expect(archived.id).toBe(s.sec1);
    expect(archived.archivedAt).not.toBeNull();

    expect((await run(["section", "get", s.sec1])).exitCode).toBe(2);
    expect(await orderOf(s.draftVersionId)).toEqual([s.sec2, s.sec3]);
  });

  it("archiving an already-archived section is not-found (exit 2)", async () => {
    const { exitCode } = await run(["section", "archive", s.archivedSectionId]);
    expect(exitCode).toBe(2);
  });

  it("archiving an unknown section is not-found (exit 2)", async () => {
    const { exitCode } = await run(["section", "archive", "sec_missing"]);
    expect(exitCode).toBe(2);
  });

  it("refuses to archive a section in a published version (exit 3)", async () => {
    const { exitCode, stderr } = await run([
      "section",
      "archive",
      s.publishedSectionId,
    ]);
    expect(exitCode).toBe(3);
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("archive is one-way: cannot rename/move/archive again after", async () => {
    await run(["section", "archive", s.sec1]);
    expect(
      (await run(["section", "rename", "--title", "X", s.sec1])).exitCode
    ).toBe(2);
    expect((await run(["section", "move", s.sec1])).exitCode).toBe(2);
    expect((await run(["section", "archive", s.sec1])).exitCode).toBe(2);
  });
});
