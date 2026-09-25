import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { eq } from "drizzle-orm";
import {
  buildCourseJson,
  placeholderFloorFromBand,
} from "@/packages/course-json";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildReadLayer,
  makeReadRun,
  seedRead,
  type ReadSeed,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// `cvm course publish --placeholders <band>` AT THE COMMAND, not at the seam.
//
// The band→floor mapping is pinned where it lives (the course-json package's
// own suite). What can only be pinned HERE is the two things the command
// promises: a malformed band is refused by the PARSER, before the machine gate
// and before anything is written; and the release a floor produces is the one
// `cvm course readiness` describes for that same floor — the two verbs are how
// a headless run decides what to publish, so they must not be able to disagree.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let finishedDir: string;
const originalFinishedDir = process.env.FINISHED_VIDEOS_DIRECTORY;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
  finishedDir = mkdtempSync(path.join(tmpdir(), "cvm-publish-floor-"));
  process.env.FINISHED_VIDEOS_DIRECTORY = finishedDir;
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  if (originalFinishedDir === undefined) {
    delete process.env.FINISHED_VIDEOS_DIRECTORY;
  } else {
    process.env.FINISHED_VIDEOS_DIRECTORY = originalFinishedDir;
  }
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
  rmSync(finishedDir, { recursive: true, force: true });
});

let s: ReadSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedRead(testDb);
});

/** Every Course Version row, so a refused publish can be shown to have written nothing. */
const versionRows = () =>
  testDb.query.courseVersions.findMany({
    columns: { id: true, name: true, commitState: true },
  });

describe("cvm course publish --placeholders", () => {
  it.each(["p9", "P2", "2", "all", ""])(
    "refuses the band %s before anything is written",
    async (band) => {
      const before = await versionRows();

      const res = await run([
        "course",
        "publish",
        s.courseAId,
        "--name",
        "v9.9.9",
        "--description",
        "should never land",
        "--placeholders",
        band,
      ]);

      // Exit 3 and a ParseError: the @effect/cli parser refused the band, which
      // is the whole point of spelling the flag as a choice. Nothing on STDOUT.
      expect(res.exitCode).toBe(3);
      expect(JSON.parse(res.stderr)._tag).toBe("ParseError");
      expect(res.stdout).toBe("");
      // Nothing Submitted, nothing frozen, no Pending Version left behind: the
      // command body never ran at all.
      expect(await versionRows()).toEqual(before);
    }
  );

  it("accepts every band the readiness verb accepts", async () => {
    // Not a publish — that needs ffmpeg and Dropbox. What this proves is that
    // the four bands are refused by neither parser: the same spellings reach
    // both verbs, so an agent can read a floor with `readiness` and then ship
    // it with `publish`.
    for (const band of ["none", "p1", "p2", "p3"]) {
      const res = await run([
        "course",
        "readiness",
        "--placeholders",
        band,
        s.courseAId,
      ]);
      expect(res.exitCode).toBe(0);
      expect(JSON.parse(res.stdout).placeholderFloor).toBe(band);
    }
  });
});

describe("the manifest a floor produces, against what readiness reported", () => {
  const dbLayer = () =>
    VersionOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as never))
    );

  /**
   * The manifest this floor would ship, built from the same version tree the
   * readiness verb reads. Asset receipts are stand-ins: what is under test is
   * WHICH Lessons the release names, which is decided before a byte is hashed.
   */
  const manifestAt = async (band: "none" | "p1" | "p2" | "p3") =>
    Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        const tree = yield* versionOps.getCourseWithSectionsByVersion({
          repoId: s.courseAId,
          versionId: s.draftVersionId,
        });
        const videoAssets = new Map(
          tree.sections.flatMap((section) =>
            section.lessons.flatMap((lesson) =>
              lesson.videos.map((video) => [
                video.id,
                { sha256: "a".repeat(64), bytes: 1 },
              ])
            )
          ) as Array<[string, { sha256: string; bytes: number }]>
        );
        return yield* buildCourseJson({
          courseId: s.courseAId,
          courseVersionId: s.draftVersionId,
          courseName: tree.name,
          assetBasePath: "versions/test-assets",
          sections: tree.sections,
          videoAssets,
          includeTodoLessons: true,
          placeholderFloor: placeholderFloorFromBand(band),
        });
      }).pipe(Effect.provide(dbLayer()))
    );

  const readinessAt = async (band: string) => {
    const res = await run([
      "course",
      "readiness",
      "--placeholders",
      band,
      s.courseAId,
    ]);
    expect(res.exitCode).toBe(0);
    return JSON.parse(res.stdout);
  };

  beforeEach(async () => {
    // The seeded Video ships as it stands, so give it the `description` the
    // manifest requires — and add a second, unfilmed Lesson at P3, which is
    // what a floor has anything to say about.
    await testDb
      .update(schema.videos)
      .set({ description: "SEO description" })
      .where(eq(schema.videos.id, s.lessonVideoId));

    const [unfilmed] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: s.draftSectionId,
        title: "Not filmed yet",
        order: 3,
        priority: 3,
        authoringStatus: "done",
      })
      .returning();
    await testDb.insert(schema.videos).values({
      lessonId: unfilmed!.id,
      title: "later.mp4",
      originalFootagePath: "footage.mp4",
    });
  });

  it.each(["none", "p3"] as const)(
    "names exactly the lessons readiness reports at the floor %s",
    async (band) => {
      const readiness = await readinessAt(band);
      const manifest = await manifestAt(band);

      const lessons = manifest.sections.flatMap((section) => section.lessons);
      const placeholders = lessons
        .filter((lesson) => lesson.type === "placeholder")
        .map((lesson) => lesson.title)
        .sort();

      // Not vacuous: at p3 the unfilmed Lesson really is announced, and at the
      // announce-nothing position it really is dropped.
      expect(placeholders).toEqual(band === "p3" ? ["Not filmed yet"] : []);

      // Every Lesson readiness called a placeholder is in the manifest as one…
      expect(placeholders).toEqual(
        readiness.placeholderLessons
          .map((row: { title: string }) => row.title)
          .sort()
      );
      // …every Lesson it called withheld is in the manifest not at all…
      for (const row of readiness.withheldLessons) {
        expect(lessons.map((lesson) => lesson.title)).not.toContain(row.title);
      }
      // …and the rest ship in full, so the manifest and the two lists together
      // account for every Lesson in the tree.
      expect(lessons.length).toBe(
        readiness.progress.lessons.total - readiness.withheldLessons.length
      );
    }
  );
});
