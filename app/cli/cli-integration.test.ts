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
    DeliverableOperationsService.Default
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
