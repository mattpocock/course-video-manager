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
 * The reuse plan cancels an encode on the strength of a copy that has not
 * happened yet. These tests are about the bet losing.
 *
 * They have to go through `publish` rather than the manual re-sync, because
 * only `publish` has an export roster to cancel — which is exactly why the
 * hazard is invisible from the re-sync tests.
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

describe("CoursePublishService — when a cancelled encode is needed after all", () => {
  it("re-encodes a Video whose copy Dropbox would not make", async () => {
    const { course, run } = await setup({ videoCount: 2 });

    await run(publish(course.id, "v1.0"));
    const uploadsAfterFirstRelease = videoUploadCount();
    expect(uploadsAfterFirstRelease).toBe(2);
    expect(remoteBundleDirs()).toHaveLength(1);

    // The export garbage collector has been through: nothing of these Videos
    // is left on this machine. The reuse plan will therefore cancel BOTH
    // encodes, which is precisely the case this optimisation exists for.
    collectAllExports();

    // ...and then Dropbox refuses the batch. Both Videos fall back to the
    // upload pool, which has nothing to send. Without a way to take the
    // cancellation back, the saving turns a slow Publish into a failed one.
    // 400 rather than 500: a rejection Dropbox will not reconsider, so the
    // client gives up at once instead of backing off through its retries.
    fakeDropbox.failNextRequests({
      match: (url: string) => url.includes("/2/files/copy_batch_v2"),
      times: 1,
      status: 400,
    });

    await run(publish(course.id, "v2.0"));

    // The Publish stands, and it stands because the encodes came back.
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease + 2);
  }, 60_000);

  it("still copies, and encodes nothing, when the batch succeeds", async () => {
    const { course, run } = await setup({ videoCount: 2 });

    await run(publish(course.id, "v1.0"));
    const uploadsAfterFirstRelease = videoUploadCount();

    collectAllExports();

    await run(publish(course.id, "v2.0"));

    // The point of the whole change: a second Bundle, no encode, no upload.
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
  }, 60_000);
});
