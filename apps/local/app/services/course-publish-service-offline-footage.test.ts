import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { CoursePublishService } from "@/services/course-publish-service";
import { clips as clipsTable } from "@/db/schema";
import {
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";
import { nowMs } from "@/packages/clock";

setupPublishServiceTests();

/**
 * A Video whose Footage is on a Storage Root that is not plugged in (E:
 * offline) but whose export is already on disk still exports: the sound
 * export is reused before any Footage is looked for (#2104).
 */
describe("CoursePublishService — an export whose Footage is offline", () => {
  const offlineFootage = async (videoId: string) =>
    testDb
      .update(clipsTable)
      .set({ videoFilename: "raw-footage/on-an-unplugged-drive.mkv" })
      .where(eq(clipsTable.videoId, videoId));

  it("reuses a sound export without looking for its Footage", async () => {
    const { video, run } = await setup();
    await offlineFootage(video.id);
    const exportPath = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return (yield* svc.resolveExportPath(video.id))!;
      })
    );
    fs.writeFileSync(exportPath, "already-exported");

    const stages: string[] = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id, (stage) => {
          stages.push(stage);
        });
      })
    );

    expect(result).toBe(exportPath);
    expect(stages).toEqual([]);
    expect(fs.readFileSync(exportPath, "utf-8")).toBe("already-exported");
  });

  it("fails naming the missing Footage when there is no export to reuse", async () => {
    const { video, run } = await setup();
    await offlineFootage(video.id);

    const failure = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id).pipe(Effect.flip);
      })
    );

    expect(failure.message).toMatch(
      /^Footage not found .*raw-footage\/on-an-unplugged-drive\.mkv$/
    );
  });

  /** D: (the test's own root) plus an E: whose directory is not there. */
  const withUnpluggedE = () => {
    const unplugged = path.join(
      os.tmpdir(),
      `unplugged-e-${process.pid}-${nowMs()}`
    );
    return {
      unplugged,
      config: {
        STORAGE_ROOTS: `${path.dirname(finishedVideosDir)},${unplugged}`,
      },
    };
  };

  it('fails with "Footage not found (E: offline?)", naming the unplugged root', async () => {
    const { unplugged, config } = withUnpluggedE();
    const { video, run } = await setup({ config });
    await offlineFootage(video.id);

    const failure = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id).pipe(Effect.flip);
      })
    );

    expect(failure.message).toBe(
      `Footage not found (${unplugged} offline?): raw-footage/on-an-unplugged-drive.mkv`
    );
  });

  it("never removes the export already there when its Footage is offline", async () => {
    const { config } = withUnpluggedE();
    const { video, run } = await setup({
      config,
      // The export on disk measures short: without its Footage it can't be
      // re-made, so it must be left exactly as it is.
      measureExportDurationInSeconds: () => 1,
    });
    await offlineFootage(video.id);
    const exportPath = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return (yield* svc.resolveExportPath(video.id))!;
      })
    );
    fs.writeFileSync(exportPath, "the-only-export");

    const failure = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id).pipe(Effect.flip);
      })
    );

    expect(failure.message).toMatch(/^Footage not found \(.* offline\?\)/);
    expect(fs.readFileSync(exportPath, "utf-8")).toBe("the-only-export");
  });
});
