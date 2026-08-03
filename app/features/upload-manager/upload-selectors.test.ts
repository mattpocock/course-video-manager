import { describe, expect, it } from "vitest";
import { createInitialUploadState, uploadReducer } from "./upload-reducer";
import { findVideoUpload } from "./upload-selectors";

/** A Publish, plus the per-Video task it fans out for one of its Videos. */
const publishingVideo = (videoId: string) =>
  [
    {
      type: "START_UPLOAD",
      uploadId: "publish-1",
      videoId: "course-1",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    },
    {
      type: "START_UPLOAD",
      uploadId: `publish-1-video-${videoId}`,
      videoId,
      title: `Section/Lesson/${videoId}`,
      uploadType: "export",
      isBatchEntry: true,
      parentUploadId: "publish-1",
    },
  ].reduce(
    (state, action) => uploadReducer(state, action as uploadReducer.Action),
    createInitialUploadState()
  );

describe("findVideoUpload", () => {
  it("finds a Video's own upload", () => {
    const state = uploadReducer(createInitialUploadState(), {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "My Video",
      uploadType: "youtube",
    });

    expect(findVideoUpload(state.uploads, "video-1")?.uploadId).toBe("yt-1");
  });

  it("ignores the per-Video task a Publish spawns for that Video", () => {
    const state = publishingVideo("video-1");

    expect(findVideoUpload(state.uploads, "video-1")).toBeUndefined();
  });

  it("still finds a standalone upload started while a Publish is running", () => {
    const state = uploadReducer(publishingVideo("video-1"), {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "My Video",
      uploadType: "youtube",
    });

    expect(findVideoUpload(state.uploads, "video-1")?.uploadId).toBe("yt-1");
  });

  it("finds nothing for a Video with no upload of its own", () => {
    expect(findVideoUpload({}, "video-1")).toBeUndefined();
  });
});
