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

describe("START_UPLOAD", () => {
  it("should create entry via registry with uploading status", () => {
    const state = reduce(createState(), {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "My Video",
    });

    const upload = state.uploads["upload-1"]!;
    expect(upload.status).toBe("uploading");
    expect(upload.progress).toBe(0);
    expect(upload.errorMessage).toBeNull();
    expect(upload.retryCount).toBe(0);
    expect(upload.dependsOn).toBeNull();
  });

  it("should default uploadType to youtube", () => {
    const state = reduce(createState(), {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "My Video",
    });

    expect(state.uploads["upload-1"]!.uploadType).toBe("youtube");
  });

  it("should not affect existing uploads", () => {
    const existing = createYouTubeEntry({
      uploadId: "upload-1",
      progress: 50,
    });
    const state = reduce(createState({ uploads: { "upload-1": existing } }), {
      type: "START_UPLOAD",
      uploadId: "upload-2",
      videoId: "video-2",
      title: "Second Video",
    });

    expect(state.uploads["upload-1"]).toEqual(existing);
    expect(state.uploads["upload-2"]).toBeDefined();
  });

  it("should overwrite if same uploadId is started again", () => {
    const existing = createYouTubeEntry({
      uploadId: "upload-1",
      progress: 50,
      status: "error",
      retryCount: 3,
    });
    const state = reduce(createState({ uploads: { "upload-1": existing } }), {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "Restarted Video",
    });

    expect(state.uploads["upload-1"]!.progress).toBe(0);
    expect(state.uploads["upload-1"]!.status).toBe("uploading");
    expect(state.uploads["upload-1"]!.retryCount).toBe(0);
  });

  it("should set waiting status when dependsOn is provided", () => {
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

    expect(state.uploads["yt-1"]!.status).toBe("waiting");
    expect(state.uploads["yt-1"]!.dependsOn).toBe("export-1");
  });

  it("should create type-specific entries via registry for each upload type", () => {
    const types: uploadReducer.UploadType[] = [
      "youtube",
      "buffer",
      "ai-hero",
      "skills-changelog",
      "export",
      "dropbox-publish",
      "publish",
    ];

    for (const uploadType of types) {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: `upload-${uploadType}`,
        videoId: "video-1",
        title: "Test",
        uploadType,
      });

      expect(state.uploads[`upload-${uploadType}`]!.uploadType).toBe(
        uploadType
      );
    }
  });
});

describe("UPDATE_PROGRESS", () => {
  it("should update progress for existing upload", () => {
    const state = reduce(
      createState({
        uploads: { "upload-1": createYouTubeEntry() },
      }),
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 42 }
    );

    expect(state.uploads["upload-1"]!.progress).toBe(42);
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPDATE_PROGRESS",
      uploadId: "non-existent",
      progress: 50,
    });

    expect(state).toBe(initial);
  });

  it("should not affect other uploads", () => {
    const upload1 = createYouTubeEntry({
      uploadId: "upload-1",
      progress: 10,
    });
    const upload2 = createYouTubeEntry({
      uploadId: "upload-2",
      progress: 20,
    });
    const state = reduce(
      createState({
        uploads: { "upload-1": upload1, "upload-2": upload2 },
      }),
      { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 75 }
    );

    expect(state.uploads["upload-1"]!.progress).toBe(75);
    expect(state.uploads["upload-2"]!.progress).toBe(20);
  });
});

describe("UPLOAD_SUCCESS", () => {
  it("should set status to success via registry applySuccess", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ progress: 95 }),
        },
      }),
      {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-abc123",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.status).toBe("success");
    expect(upload.progress).toBe(100);
    expect(upload.errorMessage).toBeNull();
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPLOAD_SUCCESS",
      uploadId: "non-existent",
    });

    expect(state).toBe(initial);
  });

  it("should clear any previous error message", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({
            errorMessage: "previous error",
            status: "uploading",
          }),
        },
      }),
      {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-abc",
      }
    );

    expect(state.uploads["upload-1"]!.errorMessage).toBeNull();
  });
});

describe("UPLOAD_FATAL_ERROR", () => {
  it("moves directly to terminal error without entering auto-retry", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ retryCount: 0 }),
        },
      }),
      {
        type: "UPLOAD_FATAL_ERROR",
        uploadId: "upload-1",
        errorMessage: "Exact recovery required",
      }
    );

    expect(state.uploads["upload-1"]).toMatchObject({
      status: "error",
      terminal: true,
      errorMessage: "Exact recovery required",
    });
  });
});

describe("UPLOAD_ERROR", () => {
  it("should transition to retrying when retryCount < 3", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ retryCount: 0 }),
        },
      }),
      {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Network error",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.status).toBe("retrying");
    expect(upload.retryCount).toBe(1);
    expect(upload.errorMessage).toBe("Network error");
  });

  it("should transition to retrying on second error", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ retryCount: 1 }),
        },
      }),
      {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Network error again",
      }
    );

    expect(state.uploads["upload-1"]!.status).toBe("retrying");
    expect(state.uploads["upload-1"]!.retryCount).toBe(2);
  });

  it("should transition to error when retryCount reaches 3", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ retryCount: 2 }),
        },
      }),
      {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Final failure",
      }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.status).toBe("error");
    expect(upload.retryCount).toBe(3);
    expect(upload.errorMessage).toBe("Final failure");
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "UPLOAD_ERROR",
      uploadId: "non-existent",
      errorMessage: "error",
    });

    expect(state).toBe(initial);
  });
});

describe("RETRY", () => {
  it("should reset status to uploading and progress to 0 via registry", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({
            status: "retrying",
            retryCount: 1,
            progress: 50,
          }),
        },
      }),
      { type: "RETRY", uploadId: "upload-1" }
    );

    const upload = state.uploads["upload-1"]!;
    expect(upload.status).toBe("uploading");
    expect(upload.progress).toBe(0);
    expect(upload.retryCount).toBe(1);
  });

  it("should not modify state for non-existent upload", () => {
    const initial = createState();
    const state = reduce(initial, {
      type: "RETRY",
      uploadId: "non-existent",
    });

    expect(state).toBe(initial);
  });

  it("should preserve upload type through retry", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({
            status: "retrying",
            retryCount: 1,
          }),
        },
      }),
      { type: "RETRY", uploadId: "upload-1" }
    );

    expect(state.uploads["upload-1"]!.uploadType).toBe("youtube");
  });
});

describe("DISMISS", () => {
  it("should remove upload from state", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({ status: "success" }),
        },
      }),
      { type: "DISMISS", uploadId: "upload-1" }
    );

    expect(state.uploads["upload-1"]).toBeUndefined();
    expect(Object.keys(state.uploads)).toHaveLength(0);
  });

  it("should not affect other uploads", () => {
    const upload2 = createYouTubeEntry({
      uploadId: "upload-2",
      videoId: "video-2",
    });
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry(),
          "upload-2": upload2,
        },
      }),
      { type: "DISMISS", uploadId: "upload-1" }
    );

    expect(state.uploads["upload-1"]).toBeUndefined();
    expect(state.uploads["upload-2"]).toEqual(upload2);
  });

  it("should handle dismissing non-existent upload gracefully", () => {
    const upload1 = createYouTubeEntry();
    const state = reduce(createState({ uploads: { "upload-1": upload1 } }), {
      type: "DISMISS",
      uploadId: "non-existent",
    });

    expect(state.uploads["upload-1"]).toEqual(upload1);
  });

  it("should allow dismissing an upload that is still uploading", () => {
    const state = reduce(
      createState({
        uploads: {
          "upload-1": createYouTubeEntry({
            status: "uploading",
            progress: 50,
          }),
        },
      }),
      { type: "DISMISS", uploadId: "upload-1" }
    );

    expect(state.uploads["upload-1"]).toBeUndefined();
  });
});
