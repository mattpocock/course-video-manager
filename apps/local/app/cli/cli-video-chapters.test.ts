import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "./cli-write-test-harness";
import {
  seedIntegration,
  type IntegrationSeed,
} from "./cli-integration-test-harness";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import { LONG_PAUSE_DURATION_IN_SECONDS } from "@/services/export-duration-check";

/**
 * `video chapters` hands a Video's chapter list to callers outside the CVM
 * (an AI Hero post's chapters): each Chapter's start in the EXPORTED video.
 */

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let s: IntegrationSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedIntegration(testDb);
});

describe("video chapters", () => {
  it("gives each Chapter's start, skipping archived Clips, with an Intro at 0:00", async () => {
    const { stdout, exitCode } = await run([
      "video",
      "chapters",
      s.lessonVideoId,
    ]);
    expect(exitCode).toBe(0);
    // clip 0–10 · "Chapter One" · clip 10–20 · (an archived clip)
    expect(JSON.parse(stdout)).toEqual({
      id: s.lessonVideoId,
      title: "intro.mp4",
      exportDurationSeconds: 20 + FINAL_VIDEO_PADDING,
      chapters: [
        { title: "Intro", startTime: 0, timestamp: "0:00" },
        { title: "Chapter One", startTime: 10, timestamp: "0:10" },
      ],
    });
  });

  it("places a Chapter after a long Pause where the export puts it", async () => {
    const [video] = await testDb
      .insert(schema.videos)
      .values({ title: "paused.mp4", originalFootagePath: "f.mp4" })
      .returning();
    await testDb.insert(schema.clips).values([
      {
        videoId: video!.id,
        videoFilename: "a.mp4",
        sourceStartTime: 0,
        sourceEndTime: 59.9,
        order: "a0",
        text: "first",
        pauseType: "long",
      },
      {
        videoId: video!.id,
        videoFilename: "a.mp4",
        sourceStartTime: 60,
        sourceEndTime: 70,
        order: "a2",
        text: "second",
      },
    ]);
    await testDb.insert(schema.chapters).values([
      { videoId: video!.id, name: "Start", order: "a" },
      { videoId: video!.id, name: "After the pause", order: "a1" },
    ]);

    const { stdout, exitCode } = await run(["video", "chapters", video!.id]);
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    // 59.9 s of source + the 0.18 s long Pause = 60.08 s, so 1:00, not 0:59.
    expect(out.chapters).toEqual([
      { title: "Start", startTime: 0, timestamp: "0:00" },
      { title: "After the pause", startTime: 60, timestamp: "1:00" },
    ]);
    expect(out.exportDurationSeconds).toBeCloseTo(
      69.9 + LONG_PAUSE_DURATION_IN_SECONDS + FINAL_VIDEO_PADDING
    );
  });

  it("gives an empty list for a Video with no Chapters", async () => {
    const { stdout, exitCode } = await run([
      "video",
      "chapters",
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).chapters).toEqual([]);
  });

  it("is a not-found (exit 2) for an unknown video id", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "chapters",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("NotFoundError");
  });
});
