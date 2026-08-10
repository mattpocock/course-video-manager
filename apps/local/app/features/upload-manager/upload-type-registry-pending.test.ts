import { beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({
  publishCallbacks: null as null | Record<string, (...args: any[]) => void>,
  startPublish: vi.fn(),
}));

vi.mock("./sse-publish-client", () => ({
  startSSEPublish: vi.fn((_params, callbacks) => {
    clients.publishCallbacks = callbacks;
    clients.startPublish(_params);
    return new AbortController();
  }),
}));

import { uploadReducer } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const publishConfig = uploadTypeRegistry.publish!;

const entry: uploadReducer.PublishUploadEntry = {
  uploadId: "upload-1",
  videoId: "",
  title: "Course",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  uploadType: "publish",
  publishStage: "validating",
  newDraftVersionId: null,
  courseId: "course-1",
};

// A caught Commit failure auto-Discards the Pending Version server-side
// (issue #1401), so every publish failure reaching the browser is terminal —
// there is no client-side retry and no recoverable "pending" state.
describe("publish failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.publishCallbacks = null;
  });

  it("treats a publish error as terminal without restarting the publish", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();

    publishConfig.initiate(
      "upload-1",
      entry,
      {
        courseId: "course-1",
        name: "v1.0.0",
        description: "First release",
        includeTodoLessons: false,
      },
      dispatch,
      abortControllers
    );
    clients.publishCallbacks!.onError!(
      "Publish discarded: the Dropbox commit failed (after one retry). Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable"
    );

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "upload-1",
      errorMessage:
        "Publish discarded: the Dropbox commit failed (after one retry). Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable. Publish status may be unknown, so refresh before starting another publish.",
    });
    expect(clients.startPublish).toHaveBeenCalledTimes(1);
  });

  it("treats transport loss as terminal", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();

    publishConfig.initiate(
      "upload-1",
      entry,
      {
        courseId: "course-1",
        name: "v1.0.0",
        description: "First release",
        includeTodoLessons: false,
      },
      dispatch,
      abortControllers
    );
    clients.publishCallbacks!.onError!("Stream disconnected");

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "upload-1",
      errorMessage:
        "Stream disconnected. Publish status may be unknown, so refresh before starting another publish.",
    });
    expect(clients.startPublish).toHaveBeenCalledTimes(1);
  });

  it("fails the still-in-flight per-Video tasks on a publish-level error", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();

    publishConfig.initiate(
      "upload-1",
      entry,
      {
        courseId: "course-1",
        name: "v1.0.0",
        description: "First release",
        includeTodoLessons: false,
      },
      dispatch,
      abortControllers
    );
    clients.publishCallbacks!.onPublishVideos!([
      { id: "vid-1", title: "01-intro/01.01-welcome/Problem" },
      { id: "vid-2", title: "01-intro/01.02-setup/Solution" },
    ]);
    // vid-2 has already been shipped to Dropbox when the publish dies — its
    // task is settled. vid-1 has only finished encoding, which does NOT settle
    // it: the same task carries on into its upload.
    clients.publishCallbacks!.onVideoUploadQueued!("vid-1");
    clients.publishCallbacks!.onVideoUploadComplete!("vid-2");
    clients.publishCallbacks!.onError!("Stream disconnected");

    // The in-flight per-Video task is terminally failed, not left dangling.
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "upload-1-video-vid-1",
      errorMessage: "Stream disconnected",
    });
    // The already-shipped task is not re-touched by the failure.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPLOAD_FATAL_ERROR",
        uploadId: "upload-1-video-vid-2",
      })
    );
    // The parent publish entry still fails terminally.
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "upload-1",
      errorMessage:
        "Stream disconnected. Publish status may be unknown, so refresh before starting another publish.",
    });
  });
});
