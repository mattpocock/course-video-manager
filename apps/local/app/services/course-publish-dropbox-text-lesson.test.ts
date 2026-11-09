/**
 * ADR 0059, end to end: a Text Lesson through a real Dropbox commit.
 *
 * A Text Lesson is a Lesson whose only Video has no Clips and has a Body. It
 * ships in the manifest as `type: "text"`, and it ships no bytes: the export
 * roster never names its Video, nothing is uploaded for it, and the manifest
 * that names it is stamped `schemaVersion: 5` beside the version 5 sidecar.
 */

import { describe, it, expect } from "vitest";
import { buildCourseJsonSchema } from "@/packages/course-json";
import {
  DROPBOX_REMOTE_PATH,
  fakeDropbox,
  manifestVideos,
  receiptManifest,
  remoteBundleVideoPaths,
  setupDropboxUploadTests,
  setupUploads,
  videoUploadCount,
} from "./course-publish-dropbox-upload-test-setup";
import { findShippingVideos } from "./course-publish-video-roster";

setupDropboxUploadTests();

const lessonTypes = () =>
  receiptManifest()
    .sections.flatMap((section) => section.lessons)
    .map((lesson) => lesson.type);

const sidecarOfReceipt = () =>
  fakeDropbox
    .get(`${DROPBOX_REMOTE_PATH}/test-course/${receiptManifest().$schema}`)
    ?.content.toString("utf-8");

describe("Dropbox publish — Text Lessons", () => {
  it("uploads no .mp4 for a Text Lesson and names it in a v5 manifest", async () => {
    const { videos, sync, unclip } = await setupUploads({ videoCount: 2 });
    await unclip(videos[0]!.id);

    await sync();

    expect(videoUploadCount()).toBe(1);
    expect(remoteBundleVideoPaths()).toHaveLength(1);
    expect(manifestVideos(receiptManifest())).toHaveLength(1);
    expect(lessonTypes()).toEqual(["text", "explainer"]);
    expect(receiptManifest().schemaVersion).toBe(5);
    expect(sidecarOfReceipt()).toBe(
      JSON.stringify(buildCourseJsonSchema(5), null, 2)
    );
  });

  it("never puts a Text Lesson's Video on the export or upload roster", async () => {
    const { videos, run, version, unclip } = await setupUploads({
      videoCount: 2,
    });
    await unclip(videos[0]!.id);

    const roster = await run(findShippingVideos(version.id, true));

    expect(roster.shippingVideos.map((video) => video.id)).toEqual([
      videos[1]!.id,
    ]);
    expect(roster.unexportedVideos.map((video) => video.id)).not.toContain(
      videos[0]!.id
    );
  });

  it("keeps a Course with no Text Lesson at v4, beside the v4 sidecar", async () => {
    const { sync } = await setupUploads({ videoCount: 2 });

    await sync();

    expect(receiptManifest().schemaVersion).toBe(4);
    expect(sidecarOfReceipt()).toBe(
      JSON.stringify(buildCourseJsonSchema(4), null, 2)
    );
  });
});
