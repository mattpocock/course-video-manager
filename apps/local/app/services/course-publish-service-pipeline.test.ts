import { describe, it, expect } from "vitest";
import { Effect, Layer, Schedule } from "effect";
import fs from "node:fs";
import path from "node:path";
import { CoursePublishService } from "@/services/course-publish-service";
import { FFmpegError } from "@/services/ffmpeg-run";
import { type PauseType } from "@/services/video-processing-service";
import { VideoExportService } from "@/services/video-export-service";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { createControllableVideoProcessing } from "@/test-utils/fake-video-processing";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  isVideoUploadRequest,
  remoteBundleVideoPaths,
} from "./course-publish-service-test-setup";
import {
  honestRenderedDurationInSeconds,
  soundExportDurationProbe,
} from "@/test-utils/fake-video-processing";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

setupPublishServiceTests();

const uploadOf =
  (relativeAssetPath: string) => (url: string, init: RequestInit) =>
    isVideoUploadRequest(url, init) &&
    JSON.parse(
      (init.headers as Record<string, string>)["Dropbox-API-Arg"]!
    ).path.endsWith(`/${relativeAssetPath}`);

const publish = (courseId: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.publish({
      courseId,
      versionName: "v1.0",
      versionDescription: "First release",
      includeTodoLessons: true,
      placeholderFloor: ANNOUNCE_NOTHING,
    });
  });

describe("CoursePublishService — export/upload pipelining", () => {
  it("uploads a Video the moment its own export finishes, while another is still encoding", async () => {
    const processing = createControllableVideoProcessing({
      outputDirectory: () => finishedVideosDir,
    });
    processing.holdAll();

    const { course, videos, run } = await setup({
      videoCount: 2,
      mockVideoProcessing: processing.layer,
    });
    const [slow, quick] = videos as [(typeof videos)[0], (typeof videos)[0]];

    const quickUploadStarted = fakeDropbox.waitForRequest(
      uploadOf(quick.relativeAssetPath)
    );

    const publishing = run(publish(course.id));

    // Both encodes are in flight and held.
    await processing.waitForStart(slow.id);
    await processing.waitForStart(quick.id);

    // Let exactly one of them finish encoding.
    processing.release(quick.id);
    await quickUploadStarted;

    // The proof: `quick` reached Dropbox without waiting for `slow` to encode.
    expect(processing.isEncoding(slow.id)).toBe(true);

    processing.release(slow.id);
    await publishing;

    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 30_000);

  it("keeps six Videos in the export pool even when only one Video may upload at a time", async () => {
    const processing = createControllableVideoProcessing({
      outputDirectory: () => finishedVideosDir,
    });
    processing.holdAll();

    const { course, videos, run } = await setup({
      videoCount: 6,
      mockVideoProcessing: processing.layer,
      config: { DROPBOX_UPLOAD_CONCURRENCY: "1" },
    });

    const publishing = run(publish(course.id));

    // The two pools have independent budgets: a one-at-a-time upload limit
    // must not shrink the export pool below its six Videos in flight.
    await Promise.all(videos.map((video) => processing.waitForStart(video.id)));
    expect(processing.encodingCount()).toBe(6);

    processing.releaseAll();
    await publishing;

    expect(remoteBundleVideoPaths()).toHaveLength(6);
  }, 30_000);

  it("still reports the failed Video ids when one export fails mid-pipeline", async () => {
    // The upload pool is waiting on that Video's handoff when it fails. It has
    // to be released rather than left blocked, and the caller's error must
    // still be the failed-export one rather than whatever the commit made of it.
    // Resolved after setup, before the publish that first calls the mock.
    let doomedVideoId = "";
    const partiallyFailingProcessing = Layer.succeed(VideoExportService, {
      exportVideoClips: (opts: {
        videoId: string;
        clips?: ReadonlyArray<{ duration: number; pauseType?: PauseType }>;
      }) =>
        opts.videoId === doomedVideoId
          ? Effect.fail(
              new FFmpegError({ cause: null, message: "ffmpeg crashed" })
            )
          : Effect.sync(() => {
              const outputPath = path.join(
                finishedVideosDir,
                `${opts.videoId}.mp4`
              );
              fs.writeFileSync(outputPath, `dummy-${opts.videoId}`);
              return {
                outputPath,
                durationInSeconds: honestRenderedDurationInSeconds(opts),
              };
            }),
      getVideoDurationInSeconds: soundExportDurationProbe,
    } as any);

    const { course, videos, run } = await setup({
      videoCount: 3,
      mockVideoProcessing: partiallyFailingProcessing,
    });
    doomedVideoId = videos[1]!.id;

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
            placeholderFloor: ANNOUNCE_NOTHING,
          })
          .pipe(
            Effect.catchTag("PublishValidationError", (e) =>
              Effect.succeed({ failedExportVideoIds: e.failedExportVideoIds })
            )
          );
      })
    );

    expect(result).toEqual({ failedExportVideoIds: [videos[1]!.id] });
  }, 30_000);

  it("fails the Publish as soon as one Video's export fails, without waiting for the others", async () => {
    // Publish Job 859b8689: one Video's concat failed at 15:53:27, and the Job
    // sat on until 16:05:27 because every other Video was still encoding.
    // Here the other Videos' encodes never finish at all, so only a Publish
    // that stops them on the failure can settle.
    let doomedVideoId = "";
    const started: string[] = [];
    const interrupted: string[] = [];
    const processing = Layer.succeed(VideoExportService, {
      exportVideoClips: (opts: { videoId: string }) =>
        opts.videoId === doomedVideoId
          ? // Fails once another encode is under way, so there is one to stop:
            // which export starts first is up to the database's timing.
            Effect.sync(() => started.length > 0).pipe(
              Effect.repeat({
                until: (anyStarted) => anyStarted,
                schedule: Schedule.spaced("5 millis"),
              }),
              Effect.timeout("2 seconds"),
              Effect.ignore,
              Effect.andThen(
                Effect.fail(
                  new FFmpegError({
                    cause: null,
                    message:
                      "Failed to create concatenated video, exit code: 187\n--- ffmpeg stderr (tail) ---\nNo capable devices found",
                  })
                )
              )
            )
          : Effect.sync(() => started.push(opts.videoId)).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.sync(() => interrupted.push(opts.videoId))
              )
            ),
      getVideoDurationInSeconds: soundExportDurationProbe,
    } as any);

    const { course, videos, run } = await setup({
      videoCount: 3,
      mockVideoProcessing: processing,
    });
    doomedVideoId = videos[1]!.id;

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        const outcome = yield* svc
          .publish({
            courseId: course.id,
            versionName: "v1.0",
            versionDescription: "First release",
            includeTodoLessons: true,
            placeholderFloor: ANNOUNCE_NOTHING,
          })
          .pipe(
            Effect.catchTag("PublishValidationError", (e) =>
              Effect.succeed({
                failedExportVideoIds: e.failedExportVideoIds,
                exportFailureMessage: e.exportFailureMessage,
              })
            ),
            // Fails with a TimeoutException if the Publish does not settle.
            Effect.timeout("10 seconds")
          );
        const versionOps = yield* VersionOperationsService;
        const versions = yield* versionOps.getCourseVersions(course.id);
        return { outcome, versions };
      })
    );

    expect(result.outcome).toEqual({
      failedExportVideoIds: [videos[1]!.id],
      exportFailureMessage: expect.stringContaining(
        "Failed to create concatenated video, exit code: 187"
      ),
    });
    // The other encodes were stopped, not left running (or never begun).
    expect(started.length).toBeGreaterThan(0);
    expect(interrupted.sort()).toEqual(started.sort());
    // And the Pending Version was Discarded, as before.
    expect(result.versions.map((v) => v.commitState)).toEqual(["draft"]);
  }, 30_000);

  it("garbage-collects stale exports only after every upload has finished", async () => {
    const { course, run } = await setup();

    const stalePath = path.join(
      finishedVideosDir,
      `${course.id}-stale0000000000000000000000000000.mp4`
    );
    fs.writeFileSync(stalePath, "an export no Course Version can reach");

    // Never trips with a single Video, so uploads stay open until released.
    const releaseUploads = fakeDropbox.holdUntilInFlight(
      99,
      isVideoUploadRequest
    );
    const uploadStarted = fakeDropbox.waitForRequest(isVideoUploadRequest);

    const publishing = run(publish(course.id));
    await uploadStarted;

    // GC deletes by Export Hash reachability and cannot tell a file being
    // streamed from a stale one — so it must not have run yet.
    expect(fs.existsSync(stalePath)).toBe(true);

    releaseUploads();
    await publishing;

    expect(fs.existsSync(stalePath)).toBe(false);
  }, 30_000);
});
