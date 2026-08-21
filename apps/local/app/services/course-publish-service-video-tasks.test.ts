import { describe, it, expect } from "vitest";
import { writeAlreadyExportedVideo } from "@/test-utils/exported-video-fixture";
import { Effect } from "effect";
import path from "node:path";
import { CoursePublishService } from "@/services/course-publish-service";
import { createControllableVideoProcessing } from "@/test-utils/fake-video-processing";
import type { PublishDetailEvent } from "@/services/course-publish-export-events";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

type CapturedEvent = { event: string; data: any };

const publishCapturing = (courseId: string, events: CapturedEvent[]) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    return yield* svc.publish({
      courseId,
      versionName: "v1.0",
      versionDescription: "First release",
      includeTodoLessons: true,
      onDetailEvent: (e: PublishDetailEvent) => {
        events.push({ event: e.event, data: e.data });
      },
    });
  });

/** One Video's own events, in order, with repeats of an event collapsed. */
const timelineFor = (events: CapturedEvent[], videoId: string) =>
  events
    .filter((e) => e.data?.videoId === videoId)
    .map((e) => e.event)
    .filter((event, index, all) => event !== all[index - 1]);

describe("CoursePublishService — per-Video upload tasks", () => {
  it("names every shipping Video in the upload roster, exported or not", async () => {
    const { course, videos, run } = await setup({ videoCount: 2 });

    // One Video is already on disk, so the export roster will omit it — but it
    // still has to be uploaded, so it must still get a task of its own.
    const alreadyExported = videos[0]!;
    writeAlreadyExportedVideo(
      path.join(
        finishedVideosDir,
        `${course.id}-${alreadyExported.exportHash}.mp4`
      ),
      "already exported"
    );

    const events: CapturedEvent[] = [];
    await run(publishCapturing(course.id, events));

    const roster = events.find((e) => e.event === "upload-videos");
    expect(roster?.data.videos.map((v: any) => v.id).sort()).toEqual(
      videos.map((v) => v.id).sort()
    );
    for (const video of roster!.data.videos) {
      expect(video.title).toMatch(/^01-intro\/.+\/Problem$/);
    }

    // The export roster is the strict subset that still needs encoding.
    const exportRoster = events.find((e) => e.event === "videos");
    expect(exportRoster?.data.videos.map((v: any) => v.id)).toEqual([
      videos[1]!.id,
    ]);
  }, 30_000);

  it("walks each Video through queued-for-upload, uploading and complete", async () => {
    const { course, videos, run } = await setup({ videoCount: 2 });

    const events: CapturedEvent[] = [];
    await run(publishCapturing(course.id, events));

    for (const video of videos) {
      // A Video is only queued for upload once its own export has settled, and
      // only starts moving bytes after that.
      expect(timelineFor(events, video.id)).toEqual([
        "stage", // queued, then the ffmpeg stages
        "video-progress",
        "stage",
        "video-progress",
        "complete",
        "upload-queued",
        "upload-video-progress",
        "upload-video-complete",
      ]);
    }

    // Byte counts ride along so a consumer can weight a 1.7 GB Video above a
    // 200 MB one.
    const byVideo = (event: string, videoId: string) =>
      events.find((e) => e.event === event && e.data.videoId === videoId)!;
    for (const video of videos) {
      const started = byVideo("upload-video-progress", video.id);
      expect(started.data.uploadedBytes).toBe(0);
      expect(started.data.totalBytes).toBeGreaterThan(0);
      expect(byVideo("upload-video-complete", video.id).data.bytes).toBe(
        started.data.totalBytes
      );
    }
  }, 30_000);

  it("queues an already-exported Video for upload without waiting on any encode", async () => {
    const processing = createControllableVideoProcessing({
      outputDirectory: () => finishedVideosDir,
    });
    processing.holdAll();

    const { course, videos, run } = await setup({
      videoCount: 2,
      mockVideoProcessing: processing.layer,
    });
    const ready = videos[0]!;
    const encoding = videos[1]!;
    writeAlreadyExportedVideo(
      path.join(finishedVideosDir, `${course.id}-${ready.exportHash}.mp4`),
      "already exported"
    );

    const events: CapturedEvent[] = [];
    const publishing = run(publishCapturing(course.id, events));

    await processing.waitForStart(encoding.id);

    expect(
      events.some(
        (e) => e.event === "upload-queued" && e.data.videoId === ready.id
      )
    ).toBe(true);

    processing.release(encoding.id);
    await publishing;
  }, 30_000);

  it("attributes an upload failure to the one Video whose bytes never landed", async () => {
    const { course, videos, run } = await setup({ videoCount: 2 });
    const doomed = videos[1]!;

    // Non-transient, so the Dropbox client does not retry it away.
    fakeDropbox.failNextRequests({
      match: (url, init) =>
        url.includes("/2/files/upload") &&
        Boolean(
          JSON.parse(
            (init.headers as Record<string, string>)["Dropbox-API-Arg"] ?? "{}"
          ).path?.endsWith(`/${doomed.relativeAssetPath}`)
        ),
      times: 10,
      status: 400,
    });

    const events: CapturedEvent[] = [];
    await run(
      publishCapturing(course.id, events).pipe(
        Effect.catchAll(() => Effect.void)
      )
    );

    const failed = new Set(
      events
        .filter((e) => e.event === "upload-video-error")
        .map((e) => e.data.videoId)
    );
    expect([...failed]).toEqual([doomed.id]);
    expect(
      events.some(
        (e) =>
          e.event === "upload-video-complete" &&
          e.data.videoId === videos[0]!.id
      )
    ).toBe(true);
  }, 30_000);

  it("emits per-Video upload events even when nothing needs exporting", async () => {
    const { course, videos, run } = await setup({ videoCount: 2 });
    for (const video of videos) {
      writeAlreadyExportedVideo(
        path.join(finishedVideosDir, `${course.id}-${video.exportHash}.mp4`),
        `already exported ${video.id}`
      );
    }

    const events: CapturedEvent[] = [];
    await run(publishCapturing(course.id, events));

    for (const video of videos) {
      expect(timelineFor(events, video.id)).toEqual([
        "upload-queued",
        "upload-video-progress",
        "upload-video-complete",
      ]);
    }
  }, 30_000);
});
