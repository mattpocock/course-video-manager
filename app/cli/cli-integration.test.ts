import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { SegmentOperationsService } from "@/services/db-segment-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";

// ---------------------------------------------------------------------------
// Harness
//
// cliRuntime (app/cli/layer.ts) is hardwired to DrizzleService.Default, which
// reads DATABASE_URL via postgres-js — unreachable for the in-process PGlite
// harness. So we mirror `cliLayer` here but provide the read-operations
// services over the PGlite `testDb`. We still run the REAL `buildProgram`
// (the same program the bin runs) with a CAPTURED CliOutput layer and assert
// { stdout, stderr, exitCode } — no subprocess.
// ---------------------------------------------------------------------------

let testDb: TestDb;
let cliTestLayer: Layer.Layer<
  | DrizzleService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | VideoOperationsService
  | ClipOperationsService
  | SegmentOperationsService
  | PitchOperationsService
  | DeliverableOperationsService
  | SearchOperationsService
>;

// Mirror app/cli/layer.ts `cliLayer`, which uses `provideMerge` so the runtime
// context EXPOSES DrizzleService alongside the read services (that exposed
// DrizzleService is part of `CliServices`, hence of `buildProgram`'s R). Use
// `provideMerge` here too so the captured layer satisfies the same context.
const buildLayerFor = (db: TestDb) =>
  Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    VideoOperationsService.Default,
    ClipOperationsService.Default,
    SegmentOperationsService.Default,
    PitchOperationsService.Default,
    DeliverableOperationsService.Default,
    SearchOperationsService.Default
  ).pipe(Layer.provideMerge(Layer.succeed(DrizzleService, db as any)));

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Run a cvm command end-to-end through buildProgram with captured output. */
const run = async (
  argv: ReadonlyArray<string>,
  layer = cliTestLayer
): Promise<RunResult> => {
  const out = makeTestCliOutput();
  const exitCode = await Effect.runPromise(
    buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
  );
  return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
};

/** Parse NDJSON stdout into an array of objects (one per non-empty line). */
const ndjson = (stdout: string): unknown[] =>
  stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  cliTestLayer = buildLayerFor(testDb);
});

// ---------------------------------------------------------------------------
// Seeding — direct DB inserts (the repo's established test-seeding pattern).
// ---------------------------------------------------------------------------

interface Seed {
  courseAId: string;
  courseBArchivedId: string;
  draftVersionId: string;
  publishedVersionId: string;
  draftSectionId: string;
  oldSectionId: string;
  lessonId: string;
  lessonVideoId: string;
  clip1Id: string;
  clip2Id: string;
  archivedClipId: string;
  archivedLessonId: string;
  archivedSectionId: string;
  archivedLessonVideoId: string;
  standaloneActiveId: string;
  standaloneArchivedId: string;
  pitchActiveId: string;
  pitchArchivedId: string;
}

const seed = async (): Promise<Seed> => {
  // Two courses: one active, one archived (course has a viewable archive).
  const [courseA] = await testDb
    .insert(schema.courses)
    .values({ name: "Alpha", slug: "alpha", filePath: "/tmp/alpha" })
    .returning();
  const [courseB] = await testDb
    .insert(schema.courses)
    .values({
      name: "Beta",
      slug: "beta",
      filePath: "/tmp/beta",
      archived: true,
    })
    .returning();

  // Two versions of course A. Draft = latest by createdAt (empty name).
  const [publishedVersion] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: courseA!.id,
      name: "v1.0.0",
      description: "first publish",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    })
    .returning();
  const [draftVersion] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: courseA!.id,
      name: "",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();

  // A section in the OLD (published) version — must NOT appear for draft reads.
  const [oldSection] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: publishedVersion!.id, path: "00-old", order: 1 })
    .returning();

  // Draft structure: section -> lesson -> video -> clips/chapter + segment.
  const [draftSection] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, path: "01-intro", order: 1 })
    .returning();

  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      path: "01-welcome",
      title: "Welcome",
      order: 1,
      fsStatus: "real",
      authoringStatus: "done",
    })
    .returning();

  const [lessonVideo] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      path: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();

  const [clip1] = await testDb
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "0001",
      text: "hello",
    })
    .returning();
  const [clip2] = await testDb
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "b.mp4",
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "0003",
      text: "world",
    })
    .returning();
  const [archivedClip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "c.mp4",
      sourceStartTime: 20,
      sourceEndTime: 30,
      order: "0004",
      text: "deleted",
      archived: true,
    })
    .returning();
  await testDb.insert(schema.chapters).values({
    videoId: lessonVideo!.id,
    name: "Chapter One",
    order: "0002",
  });

  // An archived (deleted) lesson in the draft section — must never be visible.
  const [archivedLesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      path: "02-deleted",
      title: "Deleted lesson",
      order: 2,
      fsStatus: "real",
      authoringStatus: "done",
      archived: true,
    })
    .returning();

  // An archived (deleted) section in the draft version — never visible.
  const [archivedSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: draftVersion!.id,
      path: "99-deleted",
      order: 99,
      archivedAt: new Date("2024-02-01T00:00:00Z"),
    })
    .returning();

  // An archived (deleted) lesson-bound video on the active lesson — never
  // visible in lesson/version trees (only standalone videos have an archive).
  const [archivedLessonVideo] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      path: "deleted.mp4",
      originalFootagePath: "footage.mp4",
      archived: true,
    })
    .returning();

  // One active + one archived segment on the lesson video (segment archive is
  // ALWAYS hidden — no flag, never visible).
  await testDb.insert(schema.segments).values([
    {
      videoId: lessonVideo!.id,
      kind: "definition",
      title: "Active segment",
      order: "0001",
    },
    {
      videoId: lessonVideo!.id,
      kind: "definition",
      title: "Archived segment",
      order: "0002",
      archived: true,
    },
  ]);

  // Standalone videos: one active, one archived (video has a viewable archive).
  const [standaloneActive] = await testDb
    .insert(schema.videos)
    .values({ path: "standalone-active.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [standaloneArchived] = await testDb
    .insert(schema.videos)
    .values({
      path: "standalone-archived.mp4",
      originalFootagePath: "f.mp4",
      archived: true,
    })
    .returning();

  // Pitches: one active, one archived (pitch archive is ALWAYS hidden).
  const [pitchActive] = await testDb
    .insert(schema.pitches)
    .values({ title: "Active pitch" })
    .returning();
  const [pitchArchived] = await testDb
    .insert(schema.pitches)
    .values({ title: "Archived pitch", archived: true })
    .returning();

  return {
    courseAId: courseA!.id,
    courseBArchivedId: courseB!.id,
    draftVersionId: draftVersion!.id,
    publishedVersionId: publishedVersion!.id,
    draftSectionId: draftSection!.id,
    oldSectionId: oldSection!.id,
    lessonId: lesson!.id,
    lessonVideoId: lessonVideo!.id,
    clip1Id: clip1!.id,
    clip2Id: clip2!.id,
    archivedClipId: archivedClip!.id,
    archivedLessonId: archivedLesson!.id,
    archivedSectionId: archivedSection!.id,
    archivedLessonVideoId: archivedLessonVideo!.id,
    standaloneActiveId: standaloneActive!.id,
    standaloneArchivedId: standaloneArchived!.id,
    pitchActiveId: pitchActive!.id,
    pitchArchivedId: pitchArchived!.id,
  };
};

let s: Seed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seed();
});

// ===========================================================================
// NDJSON serialization
// ===========================================================================

describe("output contract: NDJSON / single object / empty", () => {
  it("list emits one raw COMPACT object per line", async () => {
    const { stdout, stderr, exitCode } = await run(["course", "list"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const lines = stdout.split("\n").filter((l) => l.length > 0);
    // Only the active course is listed (archived excluded by default).
    expect(lines).toHaveLength(1);
    // Each line is a single compact JSON object (no pretty-print newlines).
    expect(lines[0]).not.toMatch(/\n/);
    expect(lines[0]).not.toMatch(/^\{\n/);
    const obj = JSON.parse(lines[0]!) as { id: string; name: string };
    expect(obj.id).toBe(s.courseAId);
    expect(obj.name).toBe("Alpha");
  });

  it("single get emits exactly one (pretty) object", async () => {
    const { stdout, stderr, exitCode } = await run([
      "course",
      "get",
      s.courseAId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Single-object output is pretty-printed (indented).
    expect(stdout).toMatch(/\{\n {2}"/);
    const obj = JSON.parse(stdout) as { id: string };
    expect(obj.id).toBe(s.courseAId);
    // Exactly one object: the trimmed stdout parses whole.
    expect(stdout.trim().split("\n").length).toBeGreaterThan(1);
  });

  it("course get is shallow: draft sections summary only (no deep clips)", async () => {
    const { stdout, exitCode } = await run(["course", "get", s.courseAId]);
    expect(exitCode).toBe(0);
    const obj = JSON.parse(stdout) as {
      id: string;
      draftVersionId: string;
      sections: Array<Record<string, unknown>>;
      versions?: unknown;
    };
    expect(obj.id).toBe(s.courseAId);
    // Scoped to the DRAFT version, NOT every published snapshot.
    expect(obj.draftVersionId).toBe(s.draftVersionId);
    expect(obj).not.toHaveProperty("versions");
    // Only the draft version's active section, summarized (no nested children).
    expect(obj.sections.map((sec) => sec.id)).toEqual([s.draftSectionId]);
    expect(Object.keys(obj.sections[0]!).sort()).toEqual([
      "description",
      "id",
      "order",
      "path",
    ]);
    expect(obj.sections[0]).not.toHaveProperty("lessons");
  });

  it("empty list prints nothing and exits 0", async () => {
    await truncateAllTables(testDb);
    const { stdout, stderr, exitCode } = await run(["course", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("multi-id get emits NDJSON of found objects", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "get",
      s.lessonVideoId,
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const rows = ndjson(stdout) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(
      [s.lessonVideoId, s.standaloneActiveId].sort()
    );
  });
});

// ===========================================================================
// Uniform `name` on list output
// ===========================================================================

describe("uniform display name on every list", () => {
  const nameOf = (stdout: string) =>
    (ndjson(stdout) as { id: string; name: string | null }[]).map((r) => [
      r.id,
      r.name,
    ]);

  it("section list carries name mirroring path", async () => {
    const { stdout, exitCode } = await run([
      "section",
      "list",
      "--course",
      s.courseAId,
    ]);
    expect(exitCode).toBe(0);
    expect(nameOf(stdout)).toContainEqual([s.draftSectionId, "01-intro"]);
  });

  it("lesson list carries name = title", async () => {
    const { stdout, exitCode } = await run([
      "lesson",
      "list",
      "--section",
      s.draftSectionId,
    ]);
    expect(exitCode).toBe(0);
    expect(nameOf(stdout)).toContainEqual([s.lessonId, "Welcome"]);
  });

  it("video list carries name mirroring path", async () => {
    const { stdout, exitCode } = await run(["video", "list"]);
    expect(exitCode).toBe(0);
    expect(nameOf(stdout)).toContainEqual([
      s.standaloneActiveId,
      "standalone-active.mp4",
    ]);
  });

  it("pitch list carries name = title (the noun the report was about)", async () => {
    const { stdout, exitCode } = await run(["pitch", "list"]);
    expect(exitCode).toBe(0);
    expect(nameOf(stdout)).toContainEqual([s.pitchActiveId, "Active pitch"]);
  });
});

// ===========================================================================
// Error -> exit code mapping
// ===========================================================================

describe("error -> exit code mapping", () => {
  it("NotFoundError => exit 2 with _tag on stderr, stdout pure", async () => {
    const { stdout, stderr, exitCode } = await run([
      "course",
      "get",
      "does-not-exist",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as {
      _tag: string;
      entity: string;
      id: string;
    };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("course");
    expect(err.id).toBe("does-not-exist");
  });

  it("domain-level parse error (bad --depth) => exit 3 ParseError", async () => {
    const { stdout, stderr, exitCode } = await run([
      "version",
      "tree",
      "--depth",
      "not-a-number",
      s.draftVersionId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("ParseError");
  });

  it("CLI validation error (missing required flag) => exit 3 ParseError", async () => {
    // `version list` requires --course.
    const { exitCode, stdout, stderr } = await run(["version", "list"]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("ParseError");
  });

  it("misordered flag => STDERR is exactly one parseable JSON object (no framework prose leak)", async () => {
    // @effect/cli rejects an option placed AFTER a positional id. The framework
    // would normally also print a human-readable line to Console.error; the CLI
    // routes that through the CliOutput seam and suppresses it, so STDERR must be
    // a single contract JSON object an agent can JSON.parse directly.
    const { stdout, stderr, exitCode } = await run([
      "version",
      "tree",
      s.draftVersionId,
      "--depth",
      "2",
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    // Exactly one non-empty line, and it parses whole.
    const lines = stderr.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const err = JSON.parse(lines[0]!) as { _tag: string };
    expect(err._tag).toBe("ParseError");
  });

  it("db/internal failure => exit 4 DatabaseError", async () => {
    // Dedicated PGlite instance we close, so any query fails -> mapped to 4.
    const broken = await createTestDb();
    await broken.pglite.close();
    const { stdout, stderr, exitCode } = await run(
      ["course", "list"],
      buildLayerFor(broken.testDb)
    );
    expect(exitCode).toBe(4);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("DatabaseError");
  });
});

// ===========================================================================
// Multi-id get partial failure
// ===========================================================================

describe("multi-id get partial failure", () => {
  it("emits found on stdout, missing ids on stderr, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "get",
      s.lessonVideoId,
      "missing-1",
      "missing-2",
    ]);
    expect(exitCode).toBe(2);

    // stdout stays PURE data: only the found object, as NDJSON.
    const rows = ndjson(stdout) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(s.lessonVideoId);

    // Missing ids reported on stderr under the NotFoundError tag.
    const err = JSON.parse(stderr.trim()) as {
      _tag: string;
      entity: string;
      ids: string[];
    };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("video");
    expect(err.ids.sort()).toEqual(["missing-1", "missing-2"]);
  });
});

// ===========================================================================
// Archived filtering
// ===========================================================================

describe("archived filtering", () => {
  it("course list defaults to ACTIVE only", async () => {
    const rows = ndjson((await run(["course", "list"])).stdout) as {
      id: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual([s.courseAId]);
  });

  it("course list --archived reveals archived courses", async () => {
    const rows = ndjson(
      (await run(["course", "list", "--archived"])).stdout
    ) as { id: string; archived: boolean }[];
    expect(rows.map((r) => r.id)).toEqual([s.courseBArchivedId]);
    expect(rows[0]!.archived).toBe(true);
  });

  it("video list defaults to ACTIVE standalone only", async () => {
    const rows = ndjson((await run(["video", "list"])).stdout) as {
      id: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual([s.standaloneActiveId]);
  });

  it("video list --archived reveals archived standalone videos", async () => {
    const rows = ndjson(
      (await run(["video", "list", "--archived"])).stdout
    ) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([s.standaloneArchivedId]);
  });

  it("segment list NEVER shows archived (no flag, always hidden)", async () => {
    const rows = ndjson(
      (await run(["segment", "list", "--video", s.lessonVideoId])).stdout
    ) as { title: string; archived: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Active segment");
    expect(rows.every((r) => r.archived === false)).toBe(true);
  });

  it("clip get on an archived clip id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "get",
      s.archivedClipId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("clip");
  });

  it("pitch get on an archived pitch id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "pitch",
      "get",
      s.pitchArchivedId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("pitch");
  });

  it("lesson get on an archived lesson id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "lesson",
      "get",
      s.archivedLessonId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("lesson");
  });

  it("lesson tree on an archived lesson id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "lesson",
      "tree",
      s.archivedLessonId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("NotFoundError");
  });

  it("lesson tree excludes archived lesson-bound videos", async () => {
    const { stdout, exitCode } = await run([
      "lesson",
      "tree",
      "--depth",
      "all",
      s.lessonId,
    ]);
    expect(exitCode).toBe(0);
    const tree = JSON.parse(stdout) as { children: { id: string }[] };
    const videoIds = tree.children.map((c) => c.id);
    expect(videoIds).toContain(s.lessonVideoId);
    expect(videoIds).not.toContain(s.archivedLessonVideoId);
  });

  it("section get on an archived section id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "section",
      "get",
      s.archivedSectionId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("section");
  });

  it("section tree on an archived section id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "section",
      "tree",
      s.archivedSectionId,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string };
    expect(err._tag).toBe("NotFoundError");
  });

  it("version tree excludes archived lesson-bound videos", async () => {
    const { stdout, exitCode } = await run([
      "version",
      "tree",
      "--depth",
      "all",
      s.draftVersionId,
    ]);
    expect(exitCode).toBe(0);
    const tree = JSON.parse(stdout);
    const ids: string[] = [];
    const walk = (n: any) => {
      ids.push(n.id);
      (n.children ?? []).forEach(walk);
    };
    walk(tree);
    expect(ids).toContain(s.lessonVideoId);
    expect(ids).not.toContain(s.archivedLessonVideoId);
  });
});

// ===========================================================================
// Version default (Draft when --course-version omitted)
// ===========================================================================

describe("version resolution defaults to Draft", () => {
  it("section list --course resolves the DRAFT version", async () => {
    const rows = ndjson(
      (await run(["section", "list", "--course", s.courseAId])).stdout
    ) as { id: string; path: string }[];
    // Only the draft version's section, NOT the published version's section.
    expect(rows.map((r) => r.id)).toEqual([s.draftSectionId]);
    expect(rows[0]!.path).toBe("01-intro");
  });

  // The pin flag is `--course-version` (not `--version`, which @effect/cli
  // reserves as a built-in "show CLI version" flag matched even at subcommand
  // level). `--course-version` also stays faithful to the CourseVersion glossary
  // term. It pins a specific (e.g. Published) snapshot instead of the Draft.
  it("section list --course-version pins the published snapshot", async () => {
    const rows = ndjson(
      (await run(["section", "list", "--course-version", s.publishedVersionId]))
        .stdout
    ) as { id: string; path: string }[];
    expect(rows.map((r) => r.id)).toEqual([s.oldSectionId]);
    expect(rows[0]!.path).toBe("00-old");
  });
});

// ===========================================================================
// tree: shape + depth
// ===========================================================================

describe("tree skeleton + depth", () => {
  const kindsAtDepth = (node: any): Set<string> => {
    const kinds = new Set<string>();
    const walk = (n: any) => {
      kinds.add(n.kind);
      (n.children ?? []).forEach(walk);
    };
    walk(node);
    return kinds;
  };

  it("default depth 1 = entity + direct children only", async () => {
    const { stdout, exitCode } = await run([
      "version",
      "tree",
      s.draftVersionId,
    ]);
    expect(exitCode).toBe(0);
    const tree = JSON.parse(stdout);
    // Skeleton node shape: { id, kind, name, children } and nothing else.
    expect(Object.keys(tree).sort()).toEqual([
      "children",
      "id",
      "kind",
      "name",
    ]);
    expect(tree.kind).toBe("version");
    expect(tree.id).toBe(s.draftVersionId);
    // depth 1 => version + sections, but sections have NO expanded children.
    expect(tree.children.map((c: any) => c.kind)).toEqual(["section"]);
    expect(tree.children[0].id).toBe(s.draftSectionId);
    expect(tree.children[0].children).toEqual([]);
  });

  it("--depth 2 expands one more level (adds lessons)", async () => {
    const { stdout } = await run([
      "version",
      "tree",
      "--depth",
      "2",
      s.draftVersionId,
    ]);
    const tree = JSON.parse(stdout);
    const lessons = tree.children[0].children;
    expect(lessons.map((l: any) => l.kind)).toEqual(["lesson"]);
    expect(lessons[0].id).toBe(s.lessonId);
    // depth 2 stops before videos.
    expect(lessons[0].children).toEqual([]);
    expect(kindsAtDepth(tree).has("video")).toBe(false);
  });

  it("--depth all expands the full subtree", async () => {
    const { stdout } = await run([
      "version",
      "tree",
      "--depth",
      "all",
      s.draftVersionId,
    ]);
    const tree = JSON.parse(stdout);
    const kinds = kindsAtDepth(tree);
    expect(kinds.has("section")).toBe(true);
    expect(kinds.has("lesson")).toBe(true);
    expect(kinds.has("video")).toBe(true);
    // Drill down to the video node id.
    const videoNode = tree.children[0].children[0].children[0];
    expect(videoNode.kind).toBe("video");
    expect(videoNode.id).toBe(s.lessonVideoId);
  });
});

// ===========================================================================
// search
// ===========================================================================

describe("search", () => {
  it("matches a course by name, case-insensitively", async () => {
    const { stdout, stderr, exitCode } = await run(["search", "alpha"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "course",
      id: s.courseAId,
      courseId: s.courseAId,
      name: "Alpha",
      field: "name",
    });
  });

  it("matches a video's transcript (clip text) and returns the VIDEO", async () => {
    const { stdout, exitCode } = await run(["search", "hello"]);
    expect(exitCode).toBe(0);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "video",
      id: s.lessonVideoId,
      lessonId: s.lessonId,
      courseId: s.courseAId,
      field: "transcript",
    });
    expect(hits[0].snippet).toContain("hello");
  });

  it("matches a video's transcript via a chapter name", async () => {
    const { stdout } = await run(["search", "Chapter One"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "video",
      id: s.lessonVideoId,
      field: "transcript",
    });
  });

  it("path beats transcript for a video's field label", async () => {
    const { stdout } = await run(["search", "intro"]);
    const hits = ndjson(stdout) as any[];
    const video = hits.find((h) => h.kind === "video");
    expect(video).toMatchObject({ id: s.lessonVideoId, field: "path" });
  });

  it("streams hits in depth-first tree order, one per entity", async () => {
    // "intro" matches section "01-intro" and video "intro.mp4".
    const { stdout } = await run(["search", "intro"]);
    const hits = ndjson(stdout) as any[];
    expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    expect(hits[0].id).toBe(s.draftSectionId);
    expect(hits[1].id).toBe(s.lessonVideoId);
  });

  it("matches an active segment but excludes archived segments", async () => {
    const { stdout } = await run(["search", "segment"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "segment", title: "Active segment" });
  });

  it("matches an active pitch (top-level only) and excludes archived pitches", async () => {
    const { stdout } = await run(["search", "pitch"]);
    const hits = ndjson(stdout) as any[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "pitch", id: s.pitchActiveId });
  });

  it("never returns archived clips / lessons / sections", async () => {
    // "deleted" lives only in archived rows (clip text, lesson path/title, section).
    const { stdout, exitCode } = await run(["search", "deleted"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("searches the Draft version only (published-version section excluded)", async () => {
    // "00-old" is a section that exists only in the published version.
    const { stdout, exitCode } = await run(["search", "00-old"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("--type narrows result kinds", async () => {
    const only = await run(["search", "--type", "course", "alpha"]);
    expect((ndjson(only.stdout) as any[]).map((h) => h.kind)).toEqual([
      "course",
    ]);
    // "alpha" appears in no video, so a video-only filter finds nothing.
    const none = await run(["search", "--type", "video", "alpha"]);
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toBe("");
  });

  it("empty / whitespace query => exit 3 ParseError", async () => {
    for (const q of ["", "   "]) {
      const { stderr, exitCode } = await run(["search", q]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    }
  });

  it("unknown --type => exit 3 ParseError", async () => {
    const { stderr, exitCode } = await run(["search", "--type", "bogus", "x"]);
    expect(exitCode).toBe(3);
    expect(JSON.parse(stderr)._tag).toBe("ParseError");
  });

  it("no matches => no output, exit 0", async () => {
    const { stdout, stderr, exitCode } = await run(["search", "zzz-nomatch"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  describe("scoped: course / section / lesson", () => {
    it("course search confines the walk to that course's subtree", async () => {
      const { stdout } = await run(["course", "search", s.courseAId, "intro"]);
      const hits = ndjson(stdout) as any[];
      expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    });

    it("section search includes the root section and its descendants", async () => {
      const { stdout } = await run([
        "section",
        "search",
        s.draftSectionId,
        "intro",
      ]);
      const hits = ndjson(stdout) as any[];
      expect(hits.map((h) => h.kind)).toEqual(["section", "video"]);
    });

    it("section search cannot reach the course above it", async () => {
      const { stdout, exitCode } = await run([
        "section",
        "search",
        s.draftSectionId,
        "alpha",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    });

    it("lesson search finds a transcript hit in its subtree", async () => {
      const { stdout } = await run(["lesson", "search", s.lessonId, "hello"]);
      const hits = ndjson(stdout) as any[];
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ kind: "video", id: s.lessonVideoId });
    });

    it("rejects an out-of-scope --type (exit 3)", async () => {
      const { stderr, exitCode } = await run([
        "lesson",
        "search",
        "--type",
        "section",
        s.lessonId,
        "x",
      ]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    });

    it("rejects --type pitch under a course (exit 3)", async () => {
      const { exitCode, stderr } = await run([
        "course",
        "search",
        "--type",
        "pitch",
        s.courseAId,
        "x",
      ]);
      expect(exitCode).toBe(3);
      expect(JSON.parse(stderr)._tag).toBe("ParseError");
    });

    it("unknown scope id => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "course",
        "search",
        "does-not-exist",
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("course");
    });

    it("archived scope root => exit 2 NotFoundError", async () => {
      const { exitCode } = await run([
        "course",
        "search",
        s.courseBArchivedId,
        "x",
      ]);
      expect(exitCode).toBe(2);
    });

    it("archived section root => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "section",
        "search",
        s.archivedSectionId,
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("section");
    });

    it("archived lesson root => exit 2 NotFoundError", async () => {
      const { stderr, exitCode } = await run([
        "lesson",
        "search",
        s.archivedLessonId,
        "x",
      ]);
      expect(exitCode).toBe(2);
      const err = JSON.parse(stderr);
      expect(err._tag).toBe("NotFoundError");
      expect(err.entity).toBe("lesson");
    });
  });

  describe("literal matching: SQL wildcards are escaped", () => {
    it("treats % and _ as literals in a transcript search", async () => {
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "pct.mp4",
        sourceStartTime: 30,
        sourceEndTime: 40,
        order: "0005",
        text: "save 50% today",
      });

      const literal = await run(["search", "50%"]);
      const litHits = ndjson(literal.stdout) as any[];
      expect(litHits.some((h) => h.kind === "video")).toBe(true);

      // "50_" would match "50%" if _ were a wildcard; escaped, it must not.
      const escaped = await run(["search", "50_"]);
      expect(escaped.stdout).toBe("");
    });
  });

  describe("snippet windowing", () => {
    it("excerpts a long transcript with ellipses around the match", async () => {
      const long = `${"lorem ipsum ".repeat(20)}NEEDLE${" dolor sit ".repeat(20)}`;
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "long.mp4",
        sourceStartTime: 40,
        sourceEndTime: 50,
        order: "0006",
        text: long,
      });

      const { stdout } = await run(["search", "NEEDLE"]);
      const hit = (ndjson(stdout) as any[]).find(
        (h) => h.kind === "video" && h.field === "transcript"
      );
      expect(hit.snippet).toContain("NEEDLE");
      expect(hit.snippet.startsWith("…")).toBe(true);
      expect(hit.snippet.endsWith("…")).toBe(true);
      expect(hit.snippet.length).toBeLessThan(long.length);
    });

    it("locates a match whose query contains a run of whitespace", async () => {
      // The match sits after a long pad; `matches`/ILIKE compare the raw text
      // (two spaces), but the snippet is drawn from a whitespace-collapsed copy.
      // The needle must be collapsed too, else the snippet falls back to a
      // misleading prefix that omits the actual match.
      const text = `${"pad ".repeat(30)}alpha  beta ${"tail ".repeat(30)}`;
      await testDb.insert(schema.clips).values({
        videoId: s.lessonVideoId,
        videoFilename: "spaced.mp4",
        sourceStartTime: 50,
        sourceEndTime: 60,
        order: "0007",
        text,
      });

      const { stdout } = await run(["search", "alpha  beta"]);
      const hit = (ndjson(stdout) as any[]).find(
        (h) => h.kind === "video" && h.field === "transcript"
      );
      // Snippet is centred on the collapsed match, not the head of the text.
      expect(hit.snippet).toContain("alpha beta");
      expect(hit.snippet.startsWith("…")).toBe(true);
    });
  });
});

// ===========================================================================
// segment writes: add / update / move / delete (the first write-capable noun)
// ===========================================================================

describe("segment writes (add / update / move / delete)", () => {
  interface Seg {
    id: string;
    videoId: string;
    kind: string;
    title: string;
    description: string;
    order: string;
    archived: boolean;
  }
  /** Parse a write verb's single pretty-printed JSON object. */
  const obj = (stdout: string): Seg => JSON.parse(stdout) as Seg;
  const list = async (videoId: string): Promise<Seg[]> =>
    ndjson(
      (await run(["segment", "list", "--video", videoId])).stdout
    ) as Seg[];
  const add = async (videoId: string, ...args: string[]): Promise<Seg> =>
    obj((await run(["segment", "add", "--video", videoId, ...args])).stdout);
  // A fresh, empty standalone video (segment `order` values must be real
  // fractional-index keys; the seed's "0001" segment cannot be anchored to).
  const freshVideo = async (path: string): Promise<string> => {
    const [v] = await testDb
      .insert(schema.videos)
      .values({ path, originalFootagePath: "f.mp4" })
      .returning();
    return v!.id;
  };

  it("add appends to the end with defaults, echoing the created row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Single pretty-printed JSON object (not NDJSON).
    expect(stdout).toMatch(/^\{\n/);
    const seg = obj(stdout);
    expect(seg.videoId).toBe(s.standaloneActiveId);
    expect(seg.kind).toBe("definition");
    expect(seg.title).toBe("");
    expect(seg.description).toBe("");
    expect(seg.archived).toBe(false);
    expect(typeof seg.id).toBe("string");
    expect(typeof seg.order).toBe("string");
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      seg.id,
    ]);
  });

  it("add accepts --kind, --title and --description atomically", async () => {
    const seg = await add(
      s.standaloneActiveId,
      "--kind",
      "quest",
      "--title",
      "Try it",
      "--description",
      "note here"
    );
    expect(seg.kind).toBe("quest");
    expect(seg.title).toBe("Try it");
    expect(seg.description).toBe("note here");
  });

  it("add --before inserts immediately before the anchor", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(
      s.standaloneActiveId,
      "--title",
      "Before",
      "--before",
      anchor.id
    );
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      seg.id,
      anchor.id,
    ]);
  });

  it("add --after inserts immediately after the anchor", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(s.standaloneActiveId, "--after", anchor.id);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      anchor.id,
      seg.id,
    ]);
  });

  it("add with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.standaloneActiveId,
      "--before",
      anchor.id,
      "--after",
      anchor.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("add --before an unknown segment id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "add",
      "--video",
      s.standaloneActiveId,
      "--before",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("segment");
  });

  it("update patches only the fields passed, preserving the rest", async () => {
    const created = await add(
      s.standaloneActiveId,
      "--title",
      "Orig",
      "--description",
      "d0"
    );
    const updated = obj(
      (
        await run([
          "segment",
          "update",
          "--title",
          "New",
          "--kind",
          "walkthrough",
          created.id,
        ])
      ).stdout
    );
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("New");
    expect(updated.kind).toBe("walkthrough");
    expect(updated.description).toBe("d0"); // untouched
  });

  it("update never repositions or changes the segment's video", async () => {
    const a = await add(s.standaloneActiveId, "--title", "A");
    const b = await add(s.standaloneActiveId, "--title", "B");
    const updated = obj(
      (await run(["segment", "update", "--title", "A2", a.id])).stdout
    );
    expect(updated.videoId).toBe(a.videoId); // same parent video
    expect(updated.order).toBe(a.order); // same position key
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]); // plan order preserved
  });

  it("update with no fields => invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId);
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "update",
      created.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("update with a bogus --kind => invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId);
    const { exitCode } = await run([
      "segment",
      "update",
      "--kind",
      "bogus",
      created.id,
    ]);
    expect(exitCode).toBe(3);
  });

  it("update an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "update",
      "--title",
      "x",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("segment");
  });

  it("delete archives the segment, echoes archived:true, hides it from list", async () => {
    const created = await add(s.standaloneActiveId, "--title", "Doomed");
    const del = obj((await run(["segment", "delete", created.id])).stdout);
    expect(del.id).toBe(created.id);
    expect(del.archived).toBe(true);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
      created.id
    );
  });

  it("delete an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "delete",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "segment"
    );
  });

  it("any write on an already-deleted segment => NotFoundError, exit 2", async () => {
    const created = await add(s.standaloneActiveId);
    await run(["segment", "delete", created.id]);
    expect(
      (await run(["segment", "update", "--title", "x", created.id])).exitCode
    ).toBe(2);
    expect((await run(["segment", "delete", created.id])).exitCode).toBe(2);
    expect(
      (
        await run([
          "segment",
          "move",
          "--video",
          s.standaloneActiveId,
          created.id,
        ])
      ).exitCode
    ).toBe(2);
  });

  it("move reorders within the same video (--after)", async () => {
    const a = await add(s.standaloneActiveId, "--title", "A");
    const b = await add(s.standaloneActiveId, "--title", "B");
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
    const moved = obj(
      (
        await run([
          "segment",
          "move",
          "--video",
          s.standaloneActiveId,
          "--after",
          b.id,
          a.id,
        ])
      ).stdout
    );
    expect(moved.id).toBe(a.id);
    expect(moved.videoId).toBe(s.standaloneActiveId);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it("move relocates a segment into another video (append at end)", async () => {
    const target = await freshVideo("seg-writes-target.mp4");
    const existing = await add(target, "--title", "Existing target segment");
    const seg = await add(s.standaloneActiveId, "--title", "Movable");
    const moved = obj(
      (await run(["segment", "move", "--video", target, seg.id])).stdout
    );
    expect(moved.videoId).toBe(target);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
      seg.id
    );
    const dst = await list(target);
    expect(dst.map((r) => r.id)).toEqual([existing.id, seg.id]); // appended at end
  });

  it("move with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(s.standaloneActiveId, "--title", "Movable");
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "move",
      "--video",
      s.standaloneActiveId,
      "--before",
      anchor.id,
      "--after",
      anchor.id,
      seg.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("move --before an id not in the target video => NotFoundError, exit 2", async () => {
    const seg = await add(s.standaloneActiveId);
    const { stdout, stderr, exitCode } = await run([
      "segment",
      "move",
      "--video",
      s.standaloneActiveId,
      "--before",
      "seg_missing",
      seg.id,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "segment"
    );
  });
});
