/**
 * ADR 0029, end to end: what the Placeholder Floor does to a real commit.
 *
 * Two things are worth the price of a real Dropbox commit. A Placeholder Lesson
 * must ship no bytes — it is announced, not filmed — and a SYLLABUS-ONLY
 * release, with no `.mp4` in it at all, must still commit: the upload pool has
 * no work, export garbage collection has nothing to reclaim, and the atomic
 * `course.json` rename is the whole release. That case had never been
 * exercised before this ADR made it legal.
 */

import { describe, it, expect } from "vitest";
import {
  copyBatchCount,
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  manifestVideos,
  receiptManifest,
  remoteBundleVideoPaths,
  setupDropboxUploadTests,
  setupUploads,
  videoUploadCount,
} from "./course-publish-dropbox-upload-test-setup";

/** How many `files/upload` calls landed on a path ending in `suffix`. */
const uploadCountFor = (suffix: string) =>
  fakeDropbox.fetchCalls.filter((call) => {
    if (!call.url.includes("/2/files/upload") || call.url.includes("session"))
      return false;
    const arg = (call.init.headers as Record<string, string> | undefined)?.[
      "Dropbox-API-Arg"
    ];
    return Boolean(arg && JSON.parse(arg).path.endsWith(suffix));
  }).length;

/** Where a syllabus-only release's Bundle landed, read off its receipt. */
const bundleDirOfReceipt = () =>
  `${DROPBOX_REMOTE_PATH}/test-course/${receiptManifest().$schema.replace(
    "/course.schema.json",
    ""
  )}`;

setupDropboxUploadTests();

describe("Dropbox publish upload — Placeholder Lessons", () => {
  it("ships no .mp4 for a lesson the floor announces", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    await unfilm(videos[0]!.id);

    // The seed's Lessons are at the default Priority band, P2.
    await sync(undefined, true, 2);

    expect(videoUploadCount()).toBe(1);
    expect(remoteBundleVideoPaths()).toHaveLength(1);
    const manifest = receiptManifest();
    const lessons = manifest.sections.flatMap(
      (section: any) => section.lessons
    );
    expect(lessons.map((lesson: any) => lesson.type).sort()).toEqual([
      "explainer",
      "placeholder",
    ]);
    expect(manifestVideos(manifest)).toHaveLength(1);
  });

  it("withholds the same lesson when the floor announces nothing", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    await unfilm(videos[0]!.id);

    await sync();

    const lessons = receiptManifest().sections.flatMap(
      (section: any) => section.lessons
    );
    expect(lessons.map((lesson: any) => lesson.type)).toEqual(["explainer"]);
  });

  it("re-addresses the bundle when the floor moves", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    await unfilm(videos[0]!.id);

    await sync();
    const announcingNothing = receiptManifest().$schema;

    fakeDropbox.files.clear();
    await sync(undefined, true, 2);

    expect(receiptManifest().$schema).not.toBe(announcingNothing);
  });

  it("commits a syllabus-only release that ships no video at all", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    for (const video of videos) await unfilm(video.id);

    const progress: number[] = [];
    await sync((_event, data) => progress.push(data.percentage), true, 2);

    // Nothing was uploaded, nothing was encoded, and the release still landed.
    expect(videoUploadCount()).toBe(0);
    expect(remoteBundleVideoPaths()).toEqual([]);
    expect(progress.at(-1)).toBe(100);

    const manifest = receiptManifest();
    expect(manifestVideos(manifest)).toEqual([]);
    expect(manifest.schemaVersion).toBe(4);
    const lessons = manifest.sections.flatMap(
      (section: any) => section.lessons
    );
    expect(lessons.map((lesson: any) => lesson.type)).toEqual([
      "placeholder",
      "placeholder",
    ]);
    // The Bundle directory still holds the schema sidecar and the manifest.
    const bundleDir = `${DROPBOX_REMOTE_PATH}/test-course/${manifest.$schema.replace("/course.schema.json", "")}`;
    expect(fakeDropbox.get(`${bundleDir}/course.schema.json`)).toBeTruthy();
    expect(fakeDropbox.get(`${bundleDir}/manifest.json`)).toBeTruthy();
  });

  it("resumes a syllabus-only release whose receipt never landed", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    for (const video of videos) await unfilm(video.id);

    await sync(undefined, true, 2);
    const bundleDir = bundleDirOfReceipt();

    // A Publish interrupted between the Bundle and its commit receipt: the
    // Bundle directory stands, the receipt does not.
    fakeDropbox.files.delete(
      `${DROPBOX_REMOTE_PATH}/test-course/course.json`.toLowerCase()
    );

    await sync(undefined, true, 2);

    // Re-running the same Publish resumes: the schema sidecar and manifest
    // already in place are left alone, and the receipt lands.
    expect(receiptManifest().schemaVersion).toBe(4);
    expect(fakeDropbox.get(`${bundleDir}/manifest.json`)).toBeTruthy();
    expect(videoUploadCount()).toBe(0);
    expect(uploadCountFor("/manifest.json")).toBe(1);
    expect(uploadCountFor("/course.schema.json")).toBe(1);
  });

  it("restores a syllabus-only Bundle's missing manifest", async () => {
    const { videos, sync, unfilm } = await setupUploads({ videoCount: 2 });
    for (const video of videos) await unfilm(video.id);

    await sync(undefined, true, 2);
    const bundleDir = bundleDirOfReceipt();
    fakeDropbox.files.delete(`${bundleDir}/manifest.json`.toLowerCase());

    await sync(undefined, true, 2);

    expect(fakeDropbox.get(`${bundleDir}/manifest.json`)).toBeTruthy();
    expect(fakeDropbox.get(`${bundleDir}/course.schema.json`)).toBeTruthy();
  });

  it("reuses nothing from a previous syllabus-only release", async () => {
    const { videos, sync, unfilm, refilm } = await setupUploads({
      videoCount: 2,
    });
    for (const video of videos) await unfilm(video.id);

    // The reuse plan is read off a receipt that names no Video at all, and the
    // Bundle directory it would list holds none either.
    await sync(undefined, true, 2);
    for (const video of videos) await refilm(video.id);
    await sync();

    expect(copyBatchCount()).toBe(0);
    expect(videoUploadCount()).toBe(2);
    expect(remoteBundleVideoPaths()).toHaveLength(2);
    expect(manifestVideos(receiptManifest())).toHaveLength(2);
  });
});
