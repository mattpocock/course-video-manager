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
import { computeExportHash, resolveExportPath } from "@/services/export-hash";
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
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let finishedDir: string;
const originalFinishedDir = process.env.FINISHED_VIDEOS_DIRECTORY;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
  finishedDir = mkdtempSync(path.join(tmpdir(), "cvm-readiness-"));
  process.env.FINISHED_VIDEOS_DIRECTORY = finishedDir;
});

afterAll(() => {
  if (originalFinishedDir === undefined) {
    delete process.env.FINISHED_VIDEOS_DIRECTORY;
  } else {
    process.env.FINISHED_VIDEOS_DIRECTORY = originalFinishedDir;
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
    with: { clips: { where: (c, { eq }) => eq(c.archived, false) } },
  });
  const hash = computeExportHash(
    video!.clips.map((c) => ({
      videoFilename: c.videoFilename,
      sourceStartTime: c.sourceStartTime,
      sourceEndTime: c.sourceEndTime,
    })),
    video!.format
  );
  writeFileSync(resolveExportPath(finishedDir, s.courseAId, hash!), "");
};

describe("course readiness", () => {
  it("reports the seeded video as an unexported publish blocker", async () => {
    const res = await run(["course", "readiness", s.courseAId]);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);

    expect(out.courseId).toBe(s.courseAId);
    expect(out.versionId).toBe(s.draftVersionId);
    expect(out.includesTodoLessons).toBe(true);
    expect(out.publishable).toBe(false);
    expect(out.counts.unexportedVideos).toBe(1);
    expect(out.blockers.unexportedVideos).toEqual([
      // The title is the DERIVED section/lesson path, not the raw titles.
      { id: s.lessonVideoId, title: "01-01-intro/01.01-welcome/intro.mp4" },
    ]);
  });

  it("clears the unexported blocker once the .mp4 exists on disk", async () => {
    await markSeededVideoExported();

    const res = await run(["course", "readiness", s.courseAId]);

    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.counts.unexportedVideos).toBe(0);
    expect(out.blockers.unexportedVideos).toEqual([]);
    expect(out.progress.videos.exported).toBe(1);
    expect(out.progress.videos.unexported).toBe(0);
  });

  it("counts authoring progress over the whole draft tree", async () => {
    const res = await run(["course", "readiness", s.courseAId]);

    const out = JSON.parse(res.stdout);
    // The seed's draft has one active section, one active lesson (done) and
    // one active video with clips. Archived rows are excluded throughout.
    expect(out.progress.sections).toBe(1);
    expect(out.progress.lessons).toEqual({ total: 1, todo: 0, done: 1 });
    expect(out.progress.videos.total).toBe(1);
    expect(out.progress.videos.unexported).toBe(1);
    expect(out.progress.videos.noClips).toBe(0);
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

  it("withholds a to-do lesson's video from the blockers under --exclude-todo", async () => {
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
    expect(out.progress.lessons).toEqual({ total: 1, todo: 1, done: 0 });
  });

  it("exits 2 for an unknown course id", async () => {
    const res = await run(["course", "readiness", "course_nope"]);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(JSON.parse(res.stderr)).toMatchObject({ id: "course_nope" });
  });
});
