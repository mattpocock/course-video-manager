import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  fakeDropbox,
  finishedVideosDir,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

/**
 * What a Publish does when the export garbage collector has been through and
 * nothing of a Course's Videos is left on this machine.
 *
 * No encode is ever cancelled, so both Videos are re-encoded — and because the
 * encode is reproducible they then match what Dropbox already holds and are
 * copied rather than uploaded. The first test takes the copy away; the release
 * still stands, because the bytes were on disk all along.
 *
 * They go through `publish` rather than the manual re-sync because only
 * `publish` has an export phase, which is the half that produces the bytes.
 */

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

const copyBatchCount = () =>
  fakeDropbox.fetchCalls.filter((call) =>
    call.url.includes("/2/files/copy_batch_v2")
  ).length;

/** Every `.mp4` the export pool has left in the finished videos directory. */
const exportsOnDisk = () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (full.endsWith(".mp4")) found.push(full);
    }
  };
  walk(finishedVideosDir);
  return found;
};

const remoteBundleVideoPaths = () =>
  Array.from(fakeDropbox.files.values())
    .map((stored) => stored.pathDisplay)
    .filter((remotePath) => remotePath.endsWith(".mp4"))
    .sort();

/** The `{versionFingerprint}-{assetFingerprint}` directories in Dropbox. */
const remoteBundleDirs = () =>
  Array.from(
    new Set(
      remoteBundleVideoPaths().map(
        (remotePath) => remotePath.split("/versions/")[1]!.split("/")[0]!
      )
    )
  );

/** The export garbage collector, run to completion. */
const collectAllExports = () => {
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else fs.rmSync(full, { force: true });
    }
  };
  walk(finishedVideosDir);
};

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

describe("CoursePublishService — a Publish after the exports were collected", () => {
  it("uploads a Video whose copy Dropbox would not make", async () => {
    const { course, run } = await setup({ videoCount: 2 });

    await run(publish(course.id, "v1.0"));
    const uploadsAfterFirstRelease = videoUploadCount();
    expect(uploadsAfterFirstRelease).toBe(2);
    expect(remoteBundleDirs()).toHaveLength(1);

    // The export garbage collector has been through: nothing of these Videos
    // is left on this machine.
    collectAllExports();

    // ...and then Dropbox refuses the batch. Both Videos fall back to the
    // upload pool — which has their bytes to send, because they were
    // re-encoded rather than cancelled. 400 rather than 500: a rejection
    // Dropbox will not reconsider, so the client gives up at once instead of
    // backing off through its retries.
    fakeDropbox.failNextRequests({
      match: (url: string) => url.includes("/2/files/copy_batch_v2"),
      times: 1,
      status: 400,
    });

    await run(publish(course.id, "v2.0"));

    // The Publish stands, and it stands because nothing was ever cancelled.
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease + 2);
  }, 60_000);

  it("re-encodes and then copies, sending nothing, when the batch succeeds", async () => {
    const { course, run } = await setup({ videoCount: 2 });

    await run(publish(course.id, "v1.0"));
    const uploadsAfterFirstRelease = videoUploadCount();

    collectAllExports();
    expect(exportsOnDisk()).toHaveLength(0);

    await run(publish(course.id, "v2.0"));

    // Reclaiming disk space costs GPU time, not an upload: both encodes ran
    // again, and the second Bundle was built entirely from copies.
    expect(exportsOnDisk()).toHaveLength(2);
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
    expect(copyBatchCount()).toBe(1);
  }, 60_000);
});
