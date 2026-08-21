/**
 * What a Publish does with an export it finds ALREADY on disk.
 *
 * An export is content-addressed, so a file at that address is normally proof
 * that the work is done and the export step skips it. That was how three
 * truncated exports survived: they were made before anything measured them,
 * and every later Publish skipped straight past them and shipped them again.
 *
 * These tests drive the real publish logic against a probe that reports what
 * the file on disk really is, and pin that a short one is replaced while a
 * sound one is still skipped.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { CoursePublishService } from "@/services/course-publish-service";
import { resolveExportPath } from "@/services/export-hash";
import { sidecarPath } from "@/services/export-sha256-sidecar";
import { SOUND_FAKE_EXPORT_DURATION_IN_SECONDS } from "@/test-utils/fake-video-processing";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

const publish = (courseId: string, versionName: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.publish({
      courseId,
      versionName,
      versionDescription: `${versionName} release`,
      includeTodoLessons: true,
    });
  });

/** The `.mp4` bytes the most recent Publish put in Dropbox. */
const shippedVideoBytes = () => {
  const mp4s = Array.from(fakeDropbox.files.values()).filter((stored) =>
    stored.pathDisplay.endsWith(".mp4")
  );
  return mp4s.map((stored) => stored.content.toString("utf-8"));
};

const TRUNCATED_BYTES = "an-export-made-before-anything-measured-it";

describe("CoursePublishService — when an export is already on disk", () => {
  it("re-encodes an export the probe reports as short, and ships the new bytes", async () => {
    const { course, exportHash, run } = await setup({
      renderBytes: () => "re-encoded-in-full",
      // Whatever is at the address is a truncation: the Clips ask for tens
      // of seconds and the file holds one.
      measureExportDurationInSeconds: () => 1,
    });
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash!
    );
    fs.writeFileSync(exportPath, TRUNCATED_BYTES);

    await run(publish(course.id, "v1.0"));

    expect(shippedVideoBytes()).toEqual(["re-encoded-in-full"]);
  }, 60_000);

  it("leaves no sidecar describing the bytes it threw away", async () => {
    const { course, exportHash, run } = await setup({
      renderBytes: () => "re-encoded-in-full",
      measureExportDurationInSeconds: () => 1,
    });
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash!
    );
    fs.writeFileSync(exportPath, TRUNCATED_BYTES);

    await run(publish(course.id, "v1.0"));

    const digest = JSON.parse(
      fs.readFileSync(sidecarPath(exportPath), "utf-8")
    );
    expect(digest.sha256).toBe(
      createHash("sha256").update("re-encoded-in-full").digest("hex")
    );
  }, 60_000);

  it("skips an export the probe reports as sound, exactly as before", async () => {
    const { course, exportHash, run } = await setup({
      renderBytes: () => "these-bytes-mean-the-renderer-ran",
    });
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash!
    );
    fs.writeFileSync(exportPath, "already-exported");

    await run(publish(course.id, "v1.0"));

    expect(shippedVideoBytes()).toEqual(["already-exported"]);
  }, 60_000);

  it("gives an export with no sidecar one that carries its duration", async () => {
    const { course, exportHash, run } = await setup();
    const exportPath = resolveExportPath(
      finishedVideosDir,
      course.id,
      exportHash!
    );
    fs.writeFileSync(exportPath, "already-exported");

    await run(publish(course.id, "v1.0"));

    const digest = JSON.parse(
      fs.readFileSync(sidecarPath(exportPath), "utf-8")
    );
    expect(digest.durationInSeconds).toBe(
      SOUND_FAKE_EXPORT_DURATION_IN_SECONDS
    );
  }, 60_000);

  it("asks a sound sidecar for the duration rather than probing again", async () => {
    const probedPaths: string[] = [];
    const { course, video, run } = await setup({
      measureExportDurationInSeconds: ({ exportPath }) => {
        probedPaths.push(exportPath);
        return SOUND_FAKE_EXPORT_DURATION_IN_SECONDS;
      },
    });

    // The first Publish renders the export, so its sidecar carries the
    // duration the renderer reported. Visiting it again must cost nothing.
    await run(publish(course.id, "v1.0"));
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id);
      })
    );

    expect(probedPaths).toEqual([]);
  }, 60_000);
});
