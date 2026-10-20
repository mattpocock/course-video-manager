/**
 * What a Publish sends to Dropbox, and how it recovers when a send goes wrong.
 *
 * These run the real publish logic against an in-memory Dropbox and pin four
 * things: the Bundle is addressed by the recipe rather than by the bytes,
 * several Videos go up at once, an interrupted Publish finishes rather than
 * restarts, and a rate-limited or dropped upload is retried — and one that
 * still fails says so in the job log.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Effect, Logger } from "effect";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";
import { makeJsonLogger } from "../../sidecar/json-logger";
import { syncFrozenCourseVersionToDropbox } from "./course-publish-dropbox";
import {
  fakeDropbox,
  manifestVideos,
  receiptManifest,
  remoteBundleDirs,
  remoteBundleVideoPaths,
  isVideoUploadRequest,
  setupDropboxUploadTests,
  setupUploads,
} from "./course-publish-dropbox-upload-test-setup";

setupDropboxUploadTests();

describe("Dropbox publish upload — bundle addressing", () => {
  it("addresses the bundle by Export Hash, not by the exported bytes", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const originalBundleDirs = remoteBundleDirs();
    expect(originalBundleDirs).toHaveLength(1);

    // Wipe the remote entirely and re-encode every Video to different bytes.
    // The recipe — Clips, source timings, Video Format, Export Version Key —
    // is untouched, so the destination must be untouched too.
    fakeDropbox.files.clear();
    for (const video of videos) {
      fs.writeFileSync(video.exportPath, `re-encoded-${"z".repeat(64)}`);
    }

    await sync();

    expect(remoteBundleDirs()).toEqual(originalBundleDirs);
  });

  it("keeps every Video's SHA256 and byte count in the shipped manifest", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 3 });

    await sync();

    const expected = new Map(
      videos.map((video) => {
        const bytes = fs.readFileSync(video.exportPath);
        return [
          `${video.title}.mp4`,
          {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
          },
        ];
      })
    );

    const entries = manifestVideos(receiptManifest());
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      const key = entry.relativePath.split("/").pop()!;
      expect({ sha256: entry.sha256, bytes: entry.bytes }).toEqual(
        expected.get(key)
      );
    }
  });

  it("re-derives the manifest's SHA256 from the bytes that actually shipped", async () => {
    const { videos, sync } = await setupUploads({ videoCount: 1 });

    await sync();
    fakeDropbox.files.clear();
    const reEncoded = Buffer.from(`re-encoded-${"z".repeat(64)}`);
    fs.writeFileSync(videos[0]!.exportPath, reEncoded);

    await sync();

    expect(manifestVideos(receiptManifest())[0]).toMatchObject({
      sha256: createHash("sha256").update(reEncoded).digest("hex"),
      bytes: reEncoded.length,
    });
  });

  it("lands a differing to-do lesson setting in a distinct bundle", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync(undefined, true);
    const withTodo = remoteBundleDirs();

    fakeDropbox.files.clear();
    await sync(undefined, false);
    const withoutTodo = remoteBundleDirs();

    expect(withTodo).toHaveLength(1);
    expect(withoutTodo).toHaveLength(1);
    expect(withoutTodo).not.toEqual(withTodo);
  });
});

describe("Dropbox publish upload — concurrency", () => {
  it("uploads several Videos at once, up to the default limit of 8", async () => {
    const { sync } = await setupUploads({ videoCount: 10 });

    // Deterministic: the barrier only trips if eight uploads are genuinely in
    // flight together. A serial implementation hangs rather than passing.
    fakeDropbox.holdUntilInFlight(8, isVideoUploadRequest);

    await sync();

    expect(fakeDropbox.peakConcurrentRequests(isVideoUploadRequest)).toBe(8);
    expect(remoteBundleVideoPaths()).toHaveLength(10);
  });

  it("never exceeds the configured concurrency limit", async () => {
    const { sync } = await setupUploads({
      videoCount: 6,
      config: { DROPBOX_UPLOAD_CONCURRENCY: "2" },
    });

    fakeDropbox.holdUntilInFlight(2, isVideoUploadRequest);

    await sync();

    expect(fakeDropbox.peakConcurrentRequests(isVideoUploadRequest)).toBe(2);
    expect(remoteBundleVideoPaths()).toHaveLength(6);
  });

  it("reports monotonic progress with several uploads in flight", async () => {
    const { sync } = await setupUploads({ videoCount: 6 });

    const percentages: number[] = [];
    await sync((_event, data) => percentages.push(data.percentage));

    expect(percentages.length).toBeGreaterThan(0);
    expect([...percentages].sort((a, b) => a - b)).toEqual(percentages);
    expect(percentages.at(-1)).toBe(100);
  });
});

describe("Dropbox publish upload — resumability", () => {
  it("uploads the missing Videos of an interrupted bundle instead of failing", async () => {
    const { sync } = await setupUploads({ videoCount: 3 });

    await sync();
    const allVideoPaths = remoteBundleVideoPaths();
    expect(allVideoPaths).toHaveLength(3);

    // Simulate a Publish that died partway: the bundle directory exists but
    // one Video never landed.
    const droppedPath = allVideoPaths[1]!;
    fakeDropbox.files.delete(droppedPath.toLowerCase());
    expect(remoteBundleVideoPaths()).toHaveLength(2);

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    expect(remoteBundleVideoPaths()).toEqual(allVideoPaths);
    const reUploaded = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init))
      .map(
        (call) =>
          JSON.parse(
            (call.init.headers as Record<string, string>)["Dropbox-API-Arg"]!
          ).path
      );
    expect(reUploaded).toEqual([droppedPath]);
  });

  it("restores a bundle's missing manifest without re-uploading its Videos", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync();
    const manifestPath = Array.from(fakeDropbox.files.values()).find((stored) =>
      stored.pathDisplay.endsWith("manifest.json")
    )!.pathDisplay;
    fakeDropbox.files.delete(manifestPath.toLowerCase());

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    expect(fakeDropbox.get(manifestPath)).toBeDefined();
    const videoUploads = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init));
    expect(videoUploads).toHaveLength(0);
  });

  it("uploads zero Videos when re-publishing an unchanged Course Version", async () => {
    const { sync } = await setupUploads({ videoCount: 3 });

    await sync();

    const callsBefore = fakeDropbox.fetchCalls.length;
    await sync();

    const videoUploads = fakeDropbox.fetchCalls
      .slice(callsBefore)
      .filter((call) => isVideoUploadRequest(call.url, call.init));
    expect(videoUploads).toHaveLength(0);
  });
});

describe("Dropbox publish upload — transient failures", () => {
  it("backs off and retries a rate-limited upload rather than failing", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    fakeDropbox.failNextRequests({
      match: isVideoUploadRequest,
      times: 1,
      status: 429,
      retryAfterSeconds: 1,
    });

    await sync();

    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 20_000);

  // The 2026-10-20 Publish lost two Videos to undici's "fetch failed": a
  // dropped connection was a final answer, never retried.
  it("retries an upload whose connection dropped rather than failing", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    fakeDropbox.failNextRequests({
      match: isVideoUploadRequest,
      times: 1,
      network: "drop",
    });

    await sync();

    expect(remoteBundleVideoPaths()).toHaveLength(2);
  }, 20_000);

  // The same Publish's job log went silent for twelve minutes: a Video's
  // failure was a Job Event only, so a hang looked like progress.
  it("writes a failed Video's upload to the job log by its file", async () => {
    const { course, version, run } = await setupUploads({ videoCount: 1 });
    const logDir = fs.mkdtempSync(path.join(tmpdir(), "publish-job-log-"));
    fakeDropbox.failNextRequests({
      match: isVideoUploadRequest,
      times: 1,
      status: 400,
    });

    await run(
      syncFrozenCourseVersionToDropbox({
        courseId: course.id,
        courseVersionId: version.id,
        includeTodoLessons: true,
        placeholderFloor: ANNOUNCE_NOTHING,
        awaitVideoReady: () => Effect.void,
      }).pipe(
        Effect.ignore,
        Effect.annotateLogs("jobId", "job-1"),
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            makeJsonLogger({ logDir, write: () => {} })
          )
        )
      )
    );

    const lines = fs
      .readFileSync(path.join(logDir, "job-1.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { message: unknown });
    expect(lines.map((line) => line.message)).toContainEqual(
      expect.stringMatching(
        /^publish: upload failed for .*\/Explainer1\.mp4: HTTP 400/
      )
    );
  });

  // "Upload is taking forever" could not be checked: the job log said which
  // Video failed, never how fast any of them went.
  it("writes each uploaded Video's speed, and the pool's total, to the job log", async () => {
    const { course, version, videos, run } = await setupUploads({
      videoCount: 2,
    });
    const logDir = fs.mkdtempSync(path.join(tmpdir(), "publish-job-log-"));

    await run(
      syncFrozenCourseVersionToDropbox({
        courseId: course.id,
        courseVersionId: version.id,
        includeTodoLessons: true,
        placeholderFloor: ANNOUNCE_NOTHING,
        awaitVideoReady: () => Effect.void,
      }).pipe(
        Effect.annotateLogs("jobId", "job-1"),
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            makeJsonLogger({ logDir, write: () => {} })
          )
        )
      )
    );

    const lines = fs
      .readFileSync(path.join(logDir, "job-1.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const sizes = videos.map((video) => fs.statSync(video.exportPath).size);

    const perVideo = lines.filter((line) =>
      String(line.message).startsWith("publish: uploaded ")
    );
    expect(perVideo).toHaveLength(2);
    for (const line of perVideo) {
      expect(line).toMatchObject({
        path: expect.stringMatching(/^\/Courses\/.*\.mp4$/),
        bytes: expect.any(Number),
        seconds: expect.any(Number),
        mbPerSecond: expect.any(Number),
      });
    }
    expect(perVideo.map((line) => line.bytes).sort()).toEqual(
      [...sizes].sort()
    );

    const poolDone = lines.find((line) =>
      JSON.stringify(line.message).includes("publish: upload pool done")
    );
    expect(poolDone).toMatchObject({
      bytes: sizes.reduce((sum, bytes) => sum + bytes, 0),
      seconds: expect.any(Number),
      mbPerSecond: expect.any(Number),
    });
  });
});
