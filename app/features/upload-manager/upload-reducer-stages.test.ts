import { describe, expect, it } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const createState = (
  overrides: Partial<uploadReducer.State> = {}
): uploadReducer.State => ({
  ...createInitialUploadState(),
  ...overrides,
});

const createYouTubeEntry = (
  overrides: Partial<Omit<uploadReducer.YouTubeUploadEntry, "uploadType">> = {}
): uploadReducer.YouTubeUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "youtube",
  youtubeVideoId: null,
  errorMessage: null,
  retryCount: 0,
  dependsOn: null,
  ...overrides,
});

const createBufferEntry = (
  overrides: Partial<Omit<uploadReducer.BufferUploadEntry, "uploadType">> = {}
): uploadReducer.BufferUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "buffer",
  bufferStage: "copying",
  errorMessage: null,
  retryCount: 0,
  dependsOn: null,
  ...overrides,
});

const createExportEntry = (
  overrides: Partial<Omit<uploadReducer.ExportUploadEntry, "uploadType">> = {}
): uploadReducer.ExportUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "export",
  exportStage: "queued",
  isBatchEntry: false,
  errorMessage: null,
  retryCount: 0,
  dependsOn: null,
  ...overrides,
});

const createDropboxPublishEntry = (
  overrides: Partial<
    Omit<uploadReducer.DropboxPublishUploadEntry, "uploadType">
  > = {}
): uploadReducer.DropboxPublishUploadEntry => ({
  uploadId: "upload-1",
  videoId: "",
  title: "My Course",
  progress: 0,
  status: "uploading",
  uploadType: "dropbox-publish",
  errorMessage: null,
  retryCount: 0,
  dependsOn: null,
  missingVideoCount: null,
  ...overrides,
});

const createPublishEntry = (
  overrides: Partial<Omit<uploadReducer.PublishUploadEntry, "uploadType">> = {}
): uploadReducer.PublishUploadEntry => ({
  uploadId: "upload-1",
  videoId: "",
  title: "My Course",
  progress: 0,
  status: "uploading",
  uploadType: "publish",
  publishStage: "validating",
  newDraftVersionId: null,
  courseId: "course-1",
  errorMessage: null,
  retryCount: 0,
  dependsOn: null,
  ...overrides,
});

describe("UPDATE_BUFFER_STAGE", () => {
  it("should update buffer stage for existing upload", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createBufferEntry({ bufferStage: "copying" }),
        },
      }),
      { type: "UPDATE_BUFFER_STAGE", uploadId: "upload-1", stage: "syncing" }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
      "syncing"
    );
  });

  it("should transition from syncing to sending-webhook", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createBufferEntry({ bufferStage: "syncing" }),
        },
      }),
      {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "sending-webhook",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
      "sending-webhook"
    );
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "non-existent",
      stage: "syncing",
    });

    expect(state).toBe(initial);
  });

  it("should not modify state for non-buffer upload", () => {
    const initial = createState({
      uploads: { "upload-1": createYouTubeEntry() },
    });
    const state = reduce(initial, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "upload-1",
      stage: "syncing",
    });

    expect(state).toBe(initial);
  });
});

describe("UPDATE_EXPORT_STAGE", () => {
  it("should update export stage for existing upload", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createExportEntry({
            exportStage: "concatenating-clips",
          }),
        },
      }),
      {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "upload-1",
        stage: "normalizing-audio",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "export" && upload.exportStage).toBe(
      "normalizing-audio"
    );
  });

  it("should update progress based on stage", () => {
    let state = createState({
      uploads: { "upload-1": createExportEntry() },
    });

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "upload-1",
      stage: "concatenating-clips",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(50);

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "upload-1",
      stage: "normalizing-audio",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(80);
  });

  it("should update export stage to queued", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createExportEntry({
            exportStage: "concatenating-clips",
          }),
        },
      }),
      {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "upload-1",
        stage: "queued",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "export" && upload.exportStage).toBe("queued");
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "non-existent",
      stage: "normalizing-audio",
    });

    expect(state).toBe(initial);
  });

  it("should not modify state for non-export upload", () => {
    const initial = createState({
      uploads: { "upload-1": createYouTubeEntry() },
    });
    const state = reduce(initial, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "upload-1",
      stage: "normalizing-audio",
    });

    expect(state).toBe(initial);
  });
});

describe("UPDATE_DROPBOX_PUBLISH_MISSING_COUNT", () => {
  it("should set missingVideoCount on a dropbox-publish entry", () => {
    const state = reduce(
      createState({
        uploads: { "upload-1": createDropboxPublishEntry() },
      }),
      {
        type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
        uploadId: "upload-1",
        missingVideoCount: 3,
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(
      upload.uploadType === "dropbox-publish" && upload.missingVideoCount
    ).toBe(3);
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
      uploadId: "non-existent",
      missingVideoCount: 1,
    });

    expect(state).toBe(initial);
  });

  it("should not modify state for non-dropbox-publish upload", () => {
    const initial = createState({
      uploads: { "upload-1": createYouTubeEntry() },
    });
    const state = reduce(initial, {
      type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
      uploadId: "upload-1",
      missingVideoCount: 1,
    });

    expect(state).toBe(initial);
  });
});

describe("UPDATE_PUBLISH_STAGE", () => {
  it("should update publish stage for existing publish upload", () => {
    const state = reduce(
      createState({
        uploads: { "upload-1": createPublishEntry() },
      }),
      {
        type: "UPDATE_PUBLISH_STAGE",
        uploadId: "upload-1",
        stage: "uploading",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "publish" && upload.publishStage).toBe(
      "uploading"
    );
  });

  it("should update progress based on publish stage", () => {
    let state = createState({
      uploads: { "upload-1": createPublishEntry() },
    });

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "upload-1",
      stage: "validating",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(10);

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "upload-1",
      stage: "uploading",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(40);

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "upload-1",
      stage: "freezing",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(70);

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "upload-1",
      stage: "cloning",
    });
    expect(state.uploads["upload-1"]!.progress).toBe(90);
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "non-existent",
      stage: "uploading",
    });

    expect(state).toBe(initial);
  });

  it("should not modify state for non-publish upload", () => {
    const initial = createState({
      uploads: { "upload-1": createYouTubeEntry() },
    });
    const state = reduce(initial, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "upload-1",
      stage: "uploading",
    });

    expect(state).toBe(initial);
  });
});

describe("PUBLISH_COMPLETE", () => {
  it("should set newDraftVersionId on publish entry", () => {
    const state = reduce(
      createState({
        uploads: { "upload-1": createPublishEntry() },
      }),
      {
        type: "PUBLISH_COMPLETE",
        uploadId: "upload-1",
        newDraftVersionId: "version-42",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.uploadType === "publish" && upload.newDraftVersionId).toBe(
      "version-42"
    );
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "PUBLISH_COMPLETE",
      uploadId: "non-existent",
      newDraftVersionId: "version-1",
    });

    expect(state).toBe(initial);
  });

  it("should not modify state for non-publish upload", () => {
    const initial = createState({
      uploads: { "upload-1": createYouTubeEntry() },
    });
    const state = reduce(initial, {
      type: "PUBLISH_COMPLETE",
      uploadId: "upload-1",
      newDraftVersionId: "version-1",
    });

    expect(state).toBe(initial);
  });
});

describe("buffer upload lifecycle with stages", () => {
  it("should progress through all buffer stages to success", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "buf-1",
      videoId: "video-1",
      title: "Social Post",
      uploadType: "buffer",
    });
    const started = state.uploads["buf-1"]!;
    expect(started.uploadType === "buffer" && started.bufferStage).toBe(
      "copying"
    );

    state = reduce(state, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "buf-1",
      stage: "syncing",
    });
    const syncing = state.uploads["buf-1"]!;
    expect(syncing.uploadType === "buffer" && syncing.bufferStage).toBe(
      "syncing"
    );

    state = reduce(state, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "buf-1",
      stage: "sending-webhook",
    });
    const webhook = state.uploads["buf-1"]!;
    expect(webhook.uploadType === "buffer" && webhook.bufferStage).toBe(
      "sending-webhook"
    );

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "buf-1",
    });
    const success = state.uploads["buf-1"]!;
    expect(success.status).toBe("success");
    expect(success.uploadType === "buffer" && success.bufferStage).toBeNull();
  });

  it("should reset bufferStage to copying on retry", () => {
    let state = reduce(createState(), {
      type: "START_UPLOAD",
      uploadId: "buf-1",
      videoId: "video-1",
      title: "Retrying Buffer",
      uploadType: "buffer",
    });

    state = reduce(state, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "buf-1",
      stage: "syncing",
    });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "buf-1",
      errorMessage: "Sync error",
    });
    state = reduce(state, { type: "RETRY", uploadId: "buf-1" });

    const retried = state.uploads["buf-1"]!;
    expect(retried.status).toBe("uploading");
    expect(retried.uploadType === "buffer" && retried.bufferStage).toBe(
      "copying"
    );
    expect(retried.progress).toBe(0);
  });
});

describe("export upload lifecycle with stages", () => {
  it("should progress through all export stages to success", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "exp-1",
      videoId: "video-1",
      title: "Export Video",
      uploadType: "export",
    });
    const started = state.uploads["exp-1"]!;
    expect(started.uploadType === "export" && started.exportStage).toBe(
      "queued"
    );

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "exp-1",
      stage: "concatenating-clips",
    });
    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "exp-1",
      stage: "normalizing-audio",
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "exp-1",
    });
    const success = state.uploads["exp-1"]!;
    expect(success.status).toBe("success");
    expect(success.uploadType === "export" && success.exportStage).toBeNull();
    expect(success.progress).toBe(100);
  });

  it("should reset exportStage to queued on retry", () => {
    let state = reduce(createState(), {
      type: "START_UPLOAD",
      uploadId: "exp-1",
      videoId: "video-1",
      title: "Retrying Export",
      uploadType: "export",
    });

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "exp-1",
      stage: "normalizing-audio",
    });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "exp-1",
      errorMessage: "FFmpeg crashed",
    });
    state = reduce(state, { type: "RETRY", uploadId: "exp-1" });

    const retried = state.uploads["exp-1"]!;
    expect(retried.status).toBe("uploading");
    expect(retried.uploadType === "export" && retried.exportStage).toBe(
      "queued"
    );
    expect(retried.progress).toBe(0);
  });
});

describe("publish upload lifecycle with stages", () => {
  it("should progress through publish stages to success", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "pub-1",
      videoId: "",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    });
    const started = state.uploads["pub-1"]!;
    expect(started.uploadType === "publish" && started.publishStage).toBe(
      "validating"
    );

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "pub-1",
      stage: "uploading",
    });
    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "pub-1",
      stage: "freezing",
    });
    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "pub-1",
      stage: "cloning",
    });
    state = reduce(state, {
      type: "PUBLISH_COMPLETE",
      uploadId: "pub-1",
      newDraftVersionId: "version-2",
    });
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1",
    });

    const success = state.uploads["pub-1"]!;
    expect(success.status).toBe("success");
    if (success.uploadType === "publish") {
      expect(success.newDraftVersionId).toBe("version-2");
    }
  });

  it("should reset publishStage to validating on retry", () => {
    let state = createState({
      uploads: {
        "pub-1": createPublishEntry({
          uploadId: "pub-1",
          publishStage: "freezing",
          status: "retrying",
          retryCount: 1,
        }),
      },
    });

    state = reduce(state, { type: "RETRY", uploadId: "pub-1" });

    const retried = state.uploads["pub-1"]!;
    expect(retried.status).toBe("uploading");
    if (retried.uploadType === "publish") {
      expect(retried.publishStage).toBe("validating");
      expect(retried.newDraftVersionId).toBeNull();
      expect(retried.courseId).toBe("course-1");
    }
  });
});
