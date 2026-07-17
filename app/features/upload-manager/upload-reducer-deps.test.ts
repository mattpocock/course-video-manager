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
  terminal: false,
  dependsOn: null,
  ...overrides,
});

describe("dependency chains", () => {
  it("should start dependent job in waiting status", () => {
    let state = createState();
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export Video",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "Upload to YouTube",
      dependsOn: "export-1",
    });

    expect(state.uploads["yt-1"]!.status).toBe("waiting");
    expect(state.uploads["yt-1"]!.dependsOn).toBe("export-1");
  });

  it("should activate dependent when dependency succeeds", () => {
    let state = createState();
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "Upload",
      dependsOn: "export-1",
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    expect(state.uploads["export-1"]!.status).toBe("success");
    expect(state.uploads["yt-1"]!.status).toBe("uploading");
  });

  it("should fail dependent when dependency fails permanently", () => {
    let state = createState();
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export Video",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "Upload",
      dependsOn: "export-1",
    });

    for (let i = 0; i < 2; i++) {
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "export-1",
        errorMessage: `Error ${i + 1}`,
      });
      state = reduce(state, { type: "RETRY", uploadId: "export-1" });
    }
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "export-1",
      errorMessage: "Error 3",
    });

    expect(state.uploads["export-1"]!.status).toBe("error");
    expect(state.uploads["yt-1"]!.status).toBe("error");
    expect(state.uploads["yt-1"]!.errorMessage).toBe(
      'Dependency "Export Video" failed'
    );
  });

  it("should keep dependent waiting while dependency is retrying", () => {
    let state = createState();
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "Upload",
      dependsOn: "export-1",
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "export-1",
      errorMessage: "Transient error",
    });

    expect(state.uploads["export-1"]!.status).toBe("retrying");
    expect(state.uploads["yt-1"]!.status).toBe("waiting");
  });

  it("should activate multiple dependents on dependency success", () => {
    let state = createState();
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "YouTube",
      dependsOn: "export-1",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "ah-1",
      videoId: "video-1",
      title: "AI Hero",
      uploadType: "ai-hero",
      dependsOn: "export-1",
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    expect(state.uploads["yt-1"]!.status).toBe("uploading");
    expect(state.uploads["ah-1"]!.status).toBe("uploading");
  });

  it("should preserve dependsOn through retry", () => {
    let state = createState({
      uploads: {
        "yt-1": createYouTubeEntry({
          uploadId: "yt-1",
          status: "uploading",
          dependsOn: "export-1",
        }),
      },
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "yt-1",
      errorMessage: "Timeout",
    });
    state = reduce(state, { type: "RETRY", uploadId: "yt-1" });

    expect(state.uploads["yt-1"]!.dependsOn).toBe("export-1");
  });
});

describe("concurrent uploads", () => {
  it("should handle starting multiple uploads", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "First Video",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-2",
      videoId: "video-2",
      title: "Second Video",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-3",
      videoId: "video-3",
      title: "Third Video",
    });

    expect(Object.keys(state.uploads)).toHaveLength(3);
  });

  it("should handle mixed statuses across uploads", () => {
    let state = createState({
      uploads: {
        "upload-1": createYouTubeEntry({ uploadId: "upload-1" }),
        "upload-2": createYouTubeEntry({ uploadId: "upload-2" }),
        "upload-3": createYouTubeEntry({
          uploadId: "upload-3",
          retryCount: 2,
        }),
      },
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "upload-1",
      youtubeVideoId: "yt-1",
    });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-2",
      errorMessage: "failed",
    });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-3",
      errorMessage: "final fail",
    });

    expect(state.uploads["upload-1"]!.status).toBe("success");
    expect(state.uploads["upload-2"]!.status).toBe("retrying");
    expect(state.uploads["upload-3"]!.status).toBe("error");
  });

  it("should handle concurrent uploads across different types", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "YouTube Upload",
      uploadType: "youtube",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "buf-1",
      videoId: "video-1",
      title: "Buffer Post",
      uploadType: "buffer",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "ah-1",
      videoId: "video-1",
      title: "AI Hero Post",
      uploadType: "ai-hero",
    });

    expect(state.uploads["yt-1"]!.uploadType).toBe("youtube");
    expect(state.uploads["buf-1"]!.uploadType).toBe("buffer");
    expect(state.uploads["ah-1"]!.uploadType).toBe("ai-hero");
  });
});

describe("full retry lifecycle", () => {
  it("should go through 3 retries then final error", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "Flaky Upload",
    });
    expect(state.uploads["upload-1"]!.status).toBe("uploading");

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Error 1",
    });
    expect(state.uploads["upload-1"]!.status).toBe("retrying");
    expect(state.uploads["upload-1"]!.retryCount).toBe(1);

    state = reduce(state, { type: "RETRY", uploadId: "upload-1" });
    expect(state.uploads["upload-1"]!.status).toBe("uploading");

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Error 2",
    });
    expect(state.uploads["upload-1"]!.retryCount).toBe(2);

    state = reduce(state, { type: "RETRY", uploadId: "upload-1" });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Error 3",
    });
    expect(state.uploads["upload-1"]!.status).toBe("error");
    expect(state.uploads["upload-1"]!.retryCount).toBe(3);
  });

  it("should succeed after retries", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "Eventually Succeeds",
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Transient error",
    });
    state = reduce(state, { type: "RETRY", uploadId: "upload-1" });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "upload-1",
      youtubeVideoId: "yt-success",
    });

    expect(state.uploads["upload-1"]!.status).toBe("success");
    expect(state.uploads["upload-1"]!.retryCount).toBe(1);
  });
});
