import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "@/services/export-hash";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildReadLayer,
  makeReadRun,
  seedRead,
  type ReadSeed,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// cvm course readiness — publish blockers + authoring progress.
//
// The point of these tests is the thing that makes the verb worth having: it
// reads EXPORTEDNESS OFF THE FILESYSTEM, with no CVM server running. Each test
// points FINISHED_VIDEOS_DIRECTORY at a temp dir and controls whether the
// `{courseId}-{exportHash}.mp4` file exists.
//
// Reading that directory is what makes the verb LOCAL-ONLY, so the suite
// declares the machine local the way the author's .env does; the refusal on a
// Remote Box lives in ./cli-local-only.test.ts.
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
  finishedDir = mkdtempSync(path.join(tmpdir(), "cvm-readiness-"));
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
  rmSync(finishedDir, { recursive: true, force: true });
  process.env.FINISHED_VIDEOS_DIRECTORY = finishedDir = mkdtempSync(
    path.join(tmpdir(), "cvm-readiness-")
  );
});

/** Write the `.mp4` that makes the seeded lesson video count as exported. */
const markSeededVideoExported = async () => {
  const video = await testDb.query.videos.findFirst({
    where: (v, { eq }) => eq(v.id, s.lessonVideoId),
    with: {
      clips: {
        where: (c, { eq }) => eq(c.archived, false),
        with: { overlays: true },
      },
    },
  });
  const hash = computeExportHash(toExportClips(video!.clips), video!.format);
  writeFileSync(resolveExportPath(finishedDir, s.courseAId, hash!), "");
};

describe("course readiness", () => {
  it("lists the seeded video as unexported, with its derived path as title", async () => {
    const res = await run(["course", "readiness", s.courseAId]);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);

    expect(out.courseId).toBe(s.courseAId);
    expect(out.versionId).toBe(s.draftVersionId);
    expect(out.includesTodoLessons).toBe(true);
    expect(out.counts.unexportedVideos).toBe(1);
    expect(out.exportsRequired).toBe(1);
    expect(out.unexportedVideos).toEqual([
      // The title is the DERIVED section/lesson path, not the raw titles.
      { id: s.lessonVideoId, title: "01-01-intro/01.01-welcome/intro.mp4" },
    ]);
  });

  // The load-bearing distinction: `cvm course publish` RENDERS unexported
  // videos as its exporting stage and carries on, so they must never flip
  // `publishable` to false. Only courseViewLints / invalidLessonCombos /
  // incompleteVideos do that.
  it("stays publishable when the only outstanding work is unexported videos", async () => {
    // Clear every other kind of outstanding work so the missing .mp4 is the
    // sole remaining item: a body + description (else incompleteVideos), and an
    // opening chapter before the first clip (else the missingChapters lint —
    // the seed's chapter sits at order 0002, between clips 0001 and 0003).
    await testDb
      .update(schema.videos)
      .set({ body: "body", description: "description" });
    await testDb.update(schema.chapters).set({ order: "0000" });

    const res = await run(["course", "readiness", s.courseAId]);

    const out = JSON.parse(res.stdout);
    expect(out.counts.unexportedVideos).toBe(1);
    expect(out.exportsRequired).toBe(1);
    expect(out.blockedBy).toEqual([]);
    expect(out.publishable).toBe(true);
  });

  it("reports publishable:false with the blocking lists named in blockedBy", async () => {
    const res = await run(["course", "readiness", s.courseAId]);

    const out = JSON.parse(res.stdout);
    // The seed's video has no body/description, so it is an incomplete video.
    expect(out.publishable).toBe(false);
    expect(out.blockedBy).toContain("incompleteVideos");
    // blockedBy never names the unexported list, however long it is.
    expect(out.blockedBy).not.toContain("unexportedVideos");
    expect(out.counts.unexportedVideos).toBe(1);
  });

  it("drops the video from the unexported list once its .mp4 exists on disk", async () => {
    await markSeededVideoExported();

    const res = await run(["course", "readiness", s.courseAId]);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.counts.unexportedVideos).toBe(0);
    expect(out.exportsRequired).toBe(0);
    expect(out.unexportedVideos).toEqual([]);
    expect(out.progress.videos.exported).toBe(1);
    expect(out.progress.videos.unexported).toBe(0);
  });

  it("asks for the export again once an Overlay is added", async () => {
    // The file on disk is addressed by what the Video contained when it was
    // made. A Definition Card placed since then is not in it, so the Video is
    // unexported again — the whole reason Overlays reach the Export Hash.
    await markSeededVideoExported();

    const clip = await testDb.query.clips.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.videoId, s.lessonVideoId), eq(c.archived, false)),
    });
    await testDb.insert(schema.overlays).values({
      clipId: clip!.id,
      at: 1,
      durationInSeconds: 4,
      title: "Hydration",
      description: "Attaching handlers to server-rendered HTML.",
    });

    const res = await run(["course", "readiness", s.courseAId]);

    const out = JSON.parse(res.stdout);
    expect(out.counts.unexportedVideos).toBe(1);
    expect(out.progress.videos.exported).toBe(0);
  });

  it("counts authoring progress over the whole draft tree", async () => {
    const res = await run(["course", "readiness", s.courseAId]);

    const out = JSON.parse(res.stdout);
    // The seed's draft has one active section, one active lesson (done) and
    // one active video with clips. Archived rows are excluded throughout.
    expect(out.progress.sections).toBe(1);
    expect(out.progress.lessons).toEqual({
      total: 1,
      todo: 0,
      done: 1,
      unset: 0,
    });
    expect(out.progress.videos.total).toBe(1);
    expect(out.progress.videos.unexported).toBe(1);
    expect(out.progress.videos.noClips).toBe(0);
  });

  // authoringStatus is a nullable column with no DB default, so the three
  // buckets must still sum to total — a sweep deriving "remaining = total -
  // done" would otherwise over-count.
  it("counts a lesson with no authoringStatus as unset, and the buckets sum", async () => {
    await testDb.update(schema.lessons).set({ authoringStatus: null });

    const res = await run(["course", "readiness", s.courseAId]);

    const { lessons } = JSON.parse(res.stdout).progress;
    expect(lessons).toEqual({ total: 1, todo: 0, done: 0, unset: 1 });
    expect(lessons.todo + lessons.done + lessons.unset).toBe(lessons.total);
  });

  it("measures the pinned version when --course-version is given", async () => {
    const res = await run([
      "course",
      "readiness",
      "--course-version",
      s.publishedVersionId,
      s.courseAId,
    ]);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.versionId).toBe(s.publishedVersionId);
    // The published snapshot's only section carries no lessons.
    expect(out.progress.lessons.total).toBe(0);
  });

  it("mirrors --exclude-todo back as includesTodoLessons", async () => {
    const res = await run([
      "course",
      "readiness",
      "--exclude-todo",
      s.courseAId,
    ]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).includesTodoLessons).toBe(false);
  });

  it("withholds a to-do lesson's video from the lists under --exclude-todo", async () => {
    await testDb.update(schema.lessons).set({ authoringStatus: "todo" });

    const shipping = await run(["course", "readiness", s.courseAId]);
    expect(JSON.parse(shipping.stdout).counts.unexportedVideos).toBe(1);

    const withheld = await run([
      "course",
      "readiness",
      "--exclude-todo",
      s.courseAId,
    ]);
    const out = JSON.parse(withheld.stdout);
    expect(out.counts.unexportedVideos).toBe(0);
    // Progress is toggle-independent: the work is still there to do.
    expect(out.progress.lessons).toEqual({
      total: 1,
      todo: 1,
      done: 0,
      unset: 0,
    });
  });

  it("exits 2 for an unknown course id", async () => {
    const res = await run(["course", "readiness", "course_nope"]);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(JSON.parse(res.stderr)).toMatchObject({ id: "course_nope" });
  });
});
