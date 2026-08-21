/**
 * Reuse from the previously Published Bundle.
 *
 * A new Course Version means a new Bundle address, so nothing of the previous
 * release is already at the new path. But the Videos themselves are unchanged:
 * same Clips, so the same Export Hash, so the same bytes. Those come from the
 * old Bundle by server-side copy rather than from this machine.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  copyBatchCount,
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  freezeLatestVersion,
  isVideoUploadRequest,
  manifestVideos,
  receiptManifest,
  remoteBundleDirs,
  remoteBundleVideoPaths,
  setupDropboxUploadTests,
  setupUploads,
  videoUploadCount,
} from "./course-publish-dropbox-upload-test-setup";

setupDropboxUploadTests();

describe("Dropbox publish upload — reuse from the previous Bundle", () => {
  it("copies an unchanged Video inside Dropbox rather than sending its bytes again", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    // First release. Every Video is uploaded, and the Commit receipt names
    // the Bundle they landed in.
    await sync();
    const uploadsAfterFirstRelease = videoUploadCount();
    expect(uploadsAfterFirstRelease).toBe(2);
    expect(remoteBundleDirs()).toHaveLength(1);

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    // A second Bundle exists and holds both Videos — but not one further byte
    // left this machine to put them there.
    expect(remoteBundleDirs()).toHaveLength(2);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
    expect(copyBatchCount()).toBe(1);
  }, 30_000);

  it("takes the manifest's sha256 from the local export, not from the previous manifest", async () => {
    const { course, videos, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();

    // Poison every digest in the previous Commit receipt. A copy is still
    // made — the plan matches on Dropbox's own content hash, which the
    // listing reports and the manifest cannot lie about — but any code that
    // carried the old manifest's SHA256 forward now writes a digest that
    // describes no file at all.
    const receiptPath = `${DROPBOX_REMOTE_PATH}/test-course/course.json`;
    const poisoned = receiptManifest();
    for (const video of manifestVideos(poisoned)) {
      video.sha256 = "0".repeat(64);
    }
    fakeDropbox.store(receiptPath, Buffer.from(JSON.stringify(poisoned)));

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    // Nothing crossed the wire, and the receipt still describes the bytes on
    // this machine — the Byte Hash decided the copy, the local export decided
    // the digest.
    expect(copyBatchCount()).toBe(1);
    const expected = videos
      .map((video) => {
        const bytes = fs.readFileSync(video.exportPath);
        return `${createHash("sha256").update(bytes).digest("hex")}:${bytes.length}`;
      })
      .sort();
    expect(
      manifestVideos(receiptManifest())
        .map((video) => `${video.sha256}:${video.bytes}`)
        .sort()
    ).toEqual(expected);
  }, 30_000);

  it("uploads after all when the previous Bundle's file has gone", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const uploadsAfterFirstRelease = videoUploadCount();

    // Course Builder has archived the Bundle past its 90-day TTL: the receipt
    // still promises the files, and they are no longer there.
    for (const key of Array.from(fakeDropbox.files.keys())) {
      if (key.endsWith(".mp4")) fakeDropbox.files.delete(key);
    }

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    // The Publish stands. It just paid for it.
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease + 2);
    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 30_000);

  it("reports byte-weighted progress for a Video that was copied, not sent", async () => {
    const { course, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();

    const secondVersionId = await freezeLatestVersion(course, run);
    const percentages: number[] = [];
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true,
          (_event, data) => percentages.push(data.percentage)
        );
      })
    );

    // Every Video is in the byte-weighted denominator, whether it turns out to
    // be copyable or not — so a Publish that copies the whole bundle has to
    // COMPLETE every one of them as its copy lands. Left at zero, a release
    // that sent nothing would sit at 0% until the receipt jumped it to 100.
    expect(copyBatchCount()).toBe(1);
    expect(percentages.at(-1)).toBe(100);
    expect(percentages.filter((percentage) => percentage < 100)).not.toEqual(
      []
    );
    expect([...percentages].sort((a, b) => a - b)).toEqual(percentages);
  }, 30_000);

  it("issues the copy batch while an upload is still in flight", async () => {
    const { course, videos, run, sync } = await setupUploads({ videoCount: 2 });

    await sync();

    // One Video is re-encoded, so this machine holds bytes Dropbox does not
    // and it must upload. The other is untouched, so it is copyable.
    fs.writeFileSync(videos[1]!.exportPath, `re-encoded-${"z".repeat(64)}`);

    // Deterministic: the barrier only trips if the copy batch and an upload
    // are genuinely in flight together. A copy batch issued after the UPLOAD
    // pool drains — rather than after the export pool does — hangs here
    // instead of passing.
    fakeDropbox.holdUntilInFlight(
      2,
      (url, init) =>
        isVideoUploadRequest(url, init) ||
        url.includes("/2/files/copy_batch_v2")
    );

    const secondVersionId = await freezeLatestVersion(course, run);
    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.syncFrozenVersionToDropbox(
          course.id,
          secondVersionId,
          true
        );
      })
    );

    expect(copyBatchCount()).toBe(1);
    expect(remoteBundleVideoPaths()).toHaveLength(4);
  }, 30_000);

  it("adopts a landed Video whose export has since been collected", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const landed = remoteBundleVideoPaths();
    expect(landed).toHaveLength(2);
    const uploadsAfterFirstRelease = videoUploadCount();

    // The export garbage collector has been through. Both Videos are still at
    // their Bundle address; the local files they were made from are not.
    for (const video of videos) {
      fs.rmSync(video.exportPath, { force: true });
      fs.rmSync(`${video.exportPath}.sha256`, { force: true });
    }

    // Re-syncing the same Version addresses the same Bundle, so nothing is
    // owed but the manifest's numbers — and the previous manifest has them.
    // Before the reuse plan could supply those, this read the local file to
    // recover them and discarded the whole Publish when it had gone.
    const outcome: any = await sync();

    expect(outcome.missingVideos ?? []).toEqual([]);
    expect(remoteBundleVideoPaths()).toEqual(landed);
    expect(videoUploadCount()).toBe(uploadsAfterFirstRelease);
  }, 30_000);
});
