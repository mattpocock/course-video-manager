import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  fakeDropbox,
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

/**
 * The content the fake renderer will write on its next run. A renderer whose
 * OUTPUT can change while its INPUTS do not is the whole of a re-export.
 */
let renderedBytes = "first-export";

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

/** The bytes two Videos of the identical-bytes test both end up holding. */
const SHARED_BYTES = "bytes-both-videos-share";

/**
 * Purge and export again, leaving the bytes to whatever the fake renderer has
 * been told to write for that Video this time.
 */
const reRender = (videoId: string) =>
  Effect.gen(function* () {
    const svc = yield* CoursePublishService;
    const exportPath = yield* svc.resolveExportPath(videoId);
    fs.rmSync(exportPath!, { force: true });
    return yield* svc.exportVideo(videoId);
  });

/** Only the `.mp4` uploads inside a bundle. */
const isVideoUploadRequest = (url: string, init: RequestInit) => {
  if (!url.includes("/2/files/upload") || url.includes("session")) return false;
  const arg = (init.headers as Record<string, string> | undefined)?.[
    "Dropbox-API-Arg"
  ];
  return Boolean(arg && JSON.parse(arg).path.endsWith(".mp4"));
};

const videoUploadCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    isVideoUploadRequest(call.url, call.init)
  ).length;

/** How many Video uploads carried exactly these bytes. */
const uploadsCarrying = (content: string) =>
  fakeDropbox.fetchCalls.filter(
    (call) =>
      isVideoUploadRequest(call.url, call.init) &&
      Buffer.from(call.init.body as Uint8Array).toString("utf-8") === content
  ).length;

/** Every entry of every `copy_batch_v2` call this test has made. */
const copyBatchEntries = () =>
  fakeDropbox.fetchCalls
    .filter((call) => call.url.includes("/2/files/copy_batch_v2"))
    .flatMap(
      (call) => JSON.parse(call.init.body as string).entries as Array<any>
    );

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
      renderBytes: () => renderedBytes,
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
      renderBytes: () => renderedBytes,
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

/**
 * The reuse plan is indexed by BYTE HASH, not by Export Hash — so a Video is
 * copyable from ANY identical file in the previous Bundle, not only from the
 * one at its own address.
 */
describe("CoursePublishService — when two Videos hold identical bytes", () => {
  it("costs one upload between them", async () => {
    const bytesByVideo = new Map<string, string>();
    const { course, videos, run } = await setup({
      videoCount: 2,
      renderBytes: (render) => bytesByVideo.get(render.videoId)!,
    });
    bytesByVideo.set(videos[0]!.id, SHARED_BYTES);
    bytesByVideo.set(videos[1]!.id, "second-video-own-bytes");

    await run(publish(course.id, "v1.0"));
    expect(videoUploadCount()).toBe(2);

    // The second Video is re-exported and comes out byte-identical to the
    // first — the same footage cut the same way, which is an everyday thing
    // in a course. Its Export Hash is untouched and still its own.
    bytesByVideo.set(videos[1]!.id, SHARED_BYTES);
    await run(reRender(videos[1]!.id));

    await run(publish(course.id, "v2.0"));

    // Not one further byte left this machine: both Videos of the new Bundle
    // were copied, and BOTH were copied from the single file in the previous
    // Bundle that holds those bytes — the first Video's, at an address the
    // second Video's Export Hash would never have found.
    expect(videoUploadCount()).toBe(2);
    expect(copyBatchEntries()).toHaveLength(2);
    const sources = new Set(
      copyBatchEntries().map((entry) => entry.from_path as string)
    );
    expect(sources.size).toBe(1);
    expect([...sources][0]).toContain(videos[0]!.relativeAssetPath);

    // Which is what "one upload between them" means: those bytes crossed the
    // wire exactly once, for the pair.
    expect(uploadsCarrying(SHARED_BYTES)).toBe(1);
  }, 60_000);
});
