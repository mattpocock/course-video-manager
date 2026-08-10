import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import fs from "node:fs";
import path from "node:path";
import { CoursePublishService } from "@/services/course-publish-service";
import { VideoProcessingService } from "@/services/video-processing-service";
import { createControllableVideoProcessing } from "@/test-utils/fake-video-processing";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

/** Only the `.mp4` uploads inside a bundle. */
const isVideoUploadRequest = (url: string, init: RequestInit) => {
  if (!url.includes("/2/files/upload") || url.includes("session")) return false;
  const arg = (init.headers as Record<string, string> | undefined)?.[
    "Dropbox-API-Arg"
  ];
  return Boolean(arg && JSON.parse(arg).path.endsWith(".mp4"));
};

const uploadOf =
  (relativeAssetPath: string) => (url: string, init: RequestInit) =>
    isVideoUploadRequest(url, init) &&
    JSON.parse(
      (init.headers as Record<string, string>)["Dropbox-API-Arg"]!
    ).path.endsWith(`/${relativeAssetPath}`);

const remoteBundleVideoPaths = () =>
  Array.from(fakeDropbox.files.values())
    .map((stored) => stored.pathDisplay)
    .filter((remotePath) => remotePath.endsWith(".mp4"))
    .sort();

const publish = (courseId: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.publish({
      courseId,
      versionName: "v1.0",
      versionDescription: "First release",
      includeTodoLessons: true,
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

  it("keeps export six-way concurrent even when only one Video may upload at a time", async () => {
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
    // must not throttle encoding below its own six-way concurrency.
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
    const partiallyFailingProcessing = Layer.succeed(VideoProcessingService, {
      exportVideoClips: (opts: { videoId: string }) =>
        opts.videoId === doomedVideoId
          ? Effect.fail(new Error("ffmpeg crashed"))
          : Effect.sync(() => {
              const outputPath = path.join(
                finishedVideosDir,
                `${opts.videoId}.mp4`
              );
              fs.writeFileSync(outputPath, `dummy-${opts.videoId}`);
              return outputPath;
            }),
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
