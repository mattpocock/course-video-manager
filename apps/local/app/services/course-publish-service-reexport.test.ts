import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CoursePublishService } from "@/services/course-publish-service";
import { VideoProcessingService } from "@/services/video-processing-service";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

/**
 * A re-export produces NEW BYTES AT THE SAME ADDRESS.
 *
 * The Export Hash names what the renderer was ASKED to do — clip filenames,
 * timings, order, pauses, zoom, format. It does not name what the renderer
 * actually PRODUCED. So when an encode goes wrong (a truncated output, a
 * source file that was still being written) and the author re-exports, the
 * Video's inputs have not changed: the new file lands at the same
 * `{courseId}-{exportHash}.mp4` as the bad one.
 *
 * Every downstream decision keyed on the Export Hash alone therefore believes
 * the bytes are unchanged when they are not. These tests are about the next
 * Publish shipping the OLD bytes.
 */

/** The content the fake renderer will write on its next run. */
let renderedBytes = "first-export";

/**
 * A renderer whose OUTPUT can change while its INPUTS do not — which is the
 * whole of a re-export. The shared setup's default fake always writes the same
 * string, so it can never express this case.
 */
const rerenderableVideoProcessing = Layer.succeed(VideoProcessingService, {
  exportVideoClips: (exportOpts: any) =>
    Effect.sync(() => {
      const outputPath = path.join(
        finishedVideosDir,
        `${exportOpts.videoId}.mp4`
      );
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, renderedBytes);
      return outputPath;
    }),
} as any);

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

/**
 * Purge and export again — exactly what the author does from the videos page
 * when an export came out wrong. `exportVideoCore` skips a Video whose file is
 * already on disk, so the purge is what makes the second encode happen at all.
 */
const reExport = (videoId: string, bytes: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    const exportPath = yield* svc.resolveExportPath(videoId);
    fs.rmSync(exportPath!, { force: true });
    renderedBytes = bytes;
    return yield* svc.exportVideo(videoId);
  });

/** Every `.mp4` Dropbox holds, keyed by its bundle directory. */
const bundledVideos = () => {
  const byBundle = new Map<string, Array<{ path: string; content: Buffer }>>();
  for (const stored of fakeDropbox.files.values()) {
    if (!stored.pathDisplay.endsWith(".mp4")) continue;
    const bundle = stored.pathDisplay.split("/versions/")[1]!.split("/")[0]!;
    const entries = byBundle.get(bundle) ?? [];
    entries.push({ path: stored.pathDisplay, content: stored.content });
    byBundle.set(bundle, entries);
  }
  return byBundle;
};

/** The bundle written by the most recent Publish. */
const latestBundleVideos = () => {
  const bundles = Array.from(bundledVideos().entries());
  return bundles[bundles.length - 1]![1];
};

const readCommitReceipt = (courseName: string) => {
  const stored = Array.from(fakeDropbox.files.values()).find((file) =>
    file.pathDisplay.endsWith(`${courseName}/course.json`)
  );
  return JSON.parse(stored!.content.toString("utf-8"));
};

const manifestVideos = (receipt: any): any[] =>
  receipt.sections.flatMap((section: any) =>
    section.lessons.flatMap((lesson: any) =>
      ["explainer", "problem", "solution"]
        .map((role) => lesson[role])
        .filter(Boolean)
    )
  );

describe("CoursePublishService — when a Video is re-exported", () => {
  it("ships the re-exported bytes, not the ones the previous Bundle holds", async () => {
    renderedBytes = "first-export";
    const { course, video, run } = await setup({
      videoCount: 1,
      mockVideoProcessing: rerenderableVideoProcessing,
    });

    await run(publish(course.id, "v1.0"));
    expect(latestBundleVideos()[0]!.content.toString()).toBe("first-export");

    // The first export was wrong — truncated, say. The author re-exports. The
    // Video's Clips are untouched, so the Export Hash is the same.
    await run(reExport(video.id, "re-export-that-is-not-truncated"));

    await run(publish(course.id, "v2.0"));

    // The local file is the source of truth: it was produced from this
    // Video's Clips by the newest encode this machine has run. The previous
    // Bundle holds bytes that a human has already rejected.
    const shipped = latestBundleVideos();
    expect(shipped).toHaveLength(1);
    expect(shipped[0]!.content.toString()).toBe(
      "re-export-that-is-not-truncated"
    );
  }, 60_000);

  it("records the re-exported file's SHA256 in the manifest", async () => {
    renderedBytes = "first-export";
    const { course, video, run } = await setup({
      videoCount: 1,
      mockVideoProcessing: rerenderableVideoProcessing,
    });

    await run(publish(course.id, "v1.0"));
    await run(reExport(video.id, "re-export-that-is-not-truncated"));
    await run(publish(course.id, "v2.0"));

    // The manifest's SHA256 is the downstream consumer's only proof of which
    // bytes a release carries. Copying forward the previous Bundle's digest
    // makes it describe a file nobody can produce any more.
    const expected = createHash("sha256")
      .update("re-export-that-is-not-truncated")
      .digest("hex");
    const shipped = manifestVideos(readCommitReceipt("test-course"));
    expect(shipped).toHaveLength(1);
    expect(shipped[0]!.sha256).toBe(expected);
  }, 60_000);
});
