import { beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({
  publishCallbacks: null as null | Record<string, (...args: any[]) => void>,
  dropboxCallbacks: null as null | Record<string, (...args: any[]) => void>,
  startPublish: vi.fn(),
  startDropbox: vi.fn(),
}));

vi.mock("./sse-publish-client", () => ({
  startSSEPublish: vi.fn((_params, callbacks) => {
    clients.publishCallbacks = callbacks;
    clients.startPublish(_params);
    return new AbortController();
  }),
}));

vi.mock("./sse-dropbox-publish-client", () => ({
  startSSEDropboxPublish: vi.fn((params, callbacks) => {
    clients.dropboxCallbacks = callbacks;
    clients.startDropbox(params);
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
  uploadType: "publish",
  publishStage: "validating",
  newDraftVersionId: null,
  courseId: "course-1",
};

describe("pending Dropbox publish recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.publishCallbacks = null;
    clients.dropboxCallbacks = null;
  });

  it("retries the exact frozen Course Version with the original to-do policy", () => {
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

    clients.publishCallbacks!.onDropboxCommitPending!({
      pendingVersionId: "version-pending",
      newDraftVersionId: "version-draft",
      includeTodoLessons: false,
      reason: "sync_failed",
      missingVideoIds: [],
    });

    expect(clients.startDropbox).toHaveBeenCalledWith({
      repoId: "course-1",
      courseVersionId: "version-pending",
      includeTodoLessons: false,
    });

    clients.dropboxCallbacks!.onComplete!(0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "PUBLISH_COMPLETE",
      uploadId: "upload-1",
      newDraftVersionId: "version-draft",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_SUCCESS",
      uploadId: "upload-1",
    });
  });

  it("treats original publish transport loss as terminal", () => {
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

  it("ends in a terminal error instead of restarting the original publish", () => {
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
    clients.publishCallbacks!.onDropboxCommitPending!({
      pendingVersionId: "version-pending",
      newDraftVersionId: "version-draft",
      includeTodoLessons: false,
      reason: "sync_failed",
      missingVideoIds: [],
    });
    clients.dropboxCallbacks!.onError!("Dropbox unavailable");

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPLOAD_FATAL_ERROR",
      uploadId: "upload-1",
      errorMessage:
        "Dropbox unavailable. Retry the exact frozen version from the pending publish details.",
    });
    expect(clients.startPublish).toHaveBeenCalledTimes(1);
  });
});
