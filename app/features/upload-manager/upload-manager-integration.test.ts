import { describe, expect, it, vi } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const createState = (
  overrides: Partial<uploadReducer.State> = {}
): uploadReducer.State => ({
  ...createInitialUploadState(),
  ...overrides,
});

function simulateEffect(
  prev: uploadReducer.State["uploads"],
  current: uploadReducer.State["uploads"],
  paramsMap: Map<string, { type: uploadReducer.UploadType; params: unknown }>,
  dispatch: (action: uploadReducer.Action) => void,
  abortControllers: Map<string, AbortController>
) {
  for (const [uploadId, upload] of Object.entries(current)) {
    const prevUpload = prev[uploadId];
    if (!prevUpload) continue;
    if (prevUpload.status === upload.status) continue;

    if (upload.status === "retrying") {
      dispatch({ type: "RETRY", uploadId });
      const storedParams = paramsMap.get(uploadId);
      uploadTypeRegistry[upload.uploadType].initiate(
        uploadId,
        upload,
        storedParams?.params,
        dispatch,
        abortControllers
      );
    }

    if (prevUpload.status === "waiting" && upload.status === "uploading") {
      const storedParams = paramsMap.get(uploadId);
      uploadTypeRegistry[upload.uploadType].initiate(
        uploadId,
        upload,
        storedParams?.params,
        dispatch,
        abortControllers
      );
    }
  }
}

describe("retry effect integration", () => {
  it("should recover params from unified map and call registry initiate on retry", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();
    const paramsMap = new Map<
      string,
      { type: uploadReducer.UploadType; params: unknown }
    >();

    paramsMap.set("upload-1", {
      type: "youtube",
      params: {
        description: "My desc",
        privacyStatus: "unlisted",
        thumbnailId: "thumb-1",
      },
    });

    const prev: uploadReducer.State["uploads"] = {
      "upload-1": {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 50,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      },
    };

    let state = createState({ uploads: prev });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Network error",
    });

    expect(state.uploads["upload-1"]!.status).toBe("retrying");

    simulateEffect(prev, state.uploads, paramsMap, dispatch, abortControllers);

    expect(dispatch).toHaveBeenCalledWith({
      type: "RETRY",
      uploadId: "upload-1",
    });
    expect(abortControllers.has("upload-1")).toBe(true);
  });

  it("should call initiate for each upload type with correct params", () => {
    const types: Array<{
      uploadType: uploadReducer.UploadType;
      params: unknown;
      entry: uploadReducer.UploadEntry;
    }> = [
      {
        uploadType: "youtube",
        params: {
          description: "desc",
          privacyStatus: "public",
          thumbnailId: "t1",
        },
        entry: {
          uploadId: "u1",
          videoId: "v1",
          title: "Test",
          progress: 30,
          status: "retrying" as const,
          uploadType: "youtube" as const,
          youtubeVideoId: null,
          errorMessage: "err",
          retryCount: 1,
          terminal: false,
          dependsOn: null,
        },
      },
      {
        uploadType: "buffer",
        params: { caption: "hello" },
        entry: {
          uploadId: "u2",
          videoId: "v1",
          title: "Test",
          progress: 30,
          status: "retrying" as const,
          uploadType: "buffer" as const,
          bufferStage: "uploading-blob" as const,
          errorMessage: "err",
          retryCount: 1,
          terminal: false,
          dependsOn: null,
        },
      },
      {
        uploadType: "ai-hero",
        params: { body: "content", description: "desc", slug: "slug" },
        entry: {
          uploadId: "u3",
          videoId: "v1",
          title: "Test",
          progress: 30,
          status: "retrying" as const,
          uploadType: "ai-hero" as const,
          aiHeroSlug: null,
          errorMessage: "err",
          retryCount: 1,
          terminal: false,
          dependsOn: null,
        },
      },
      {
        uploadType: "export",
        params: undefined,
        entry: {
          uploadId: "u4",
          videoId: "v1",
          title: "Test",
          progress: 30,
          status: "retrying" as const,
          uploadType: "export" as const,
          exportStage: "queued" as const,
          isBatchEntry: false,
          errorMessage: "err",
          retryCount: 1,
          terminal: false,
          dependsOn: null,
        },
      },
    ];

    for (const { uploadType, params, entry } of types) {
      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();
      const paramsMap = new Map<
        string,
        { type: uploadReducer.UploadType; params: unknown }
      >();

      paramsMap.set(entry.uploadId, { type: uploadType, params });

      const prev: uploadReducer.State["uploads"] = {
        [entry.uploadId]: { ...entry, status: "uploading" as const },
      };
      const current: uploadReducer.State["uploads"] = {
        [entry.uploadId]: entry,
      };

      simulateEffect(prev, current, paramsMap, dispatch, abortControllers);

      expect(abortControllers.has(entry.uploadId)).toBe(true);
    }
  });
});

describe("dependency activation integration", () => {
  it("should call initiate when dependency completes and status transitions from waiting to uploading", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();
    const paramsMap = new Map<
      string,
      { type: uploadReducer.UploadType; params: unknown }
    >();

    paramsMap.set("yt-1", {
      type: "youtube",
      params: {
        description: "desc",
        privacyStatus: "public",
        thumbnailId: "thumb",
      },
    });

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

    expect(state.uploads["yt-1"]!.status).toBe("waiting");

    const prev = { ...state.uploads };

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    expect(state.uploads["yt-1"]!.status).toBe("uploading");

    simulateEffect(prev, state.uploads, paramsMap, dispatch, abortControllers);

    expect(abortControllers.has("yt-1")).toBe(true);
  });

  it("should not call initiate when dependent fails due to dependency error cascade", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();
    const paramsMap = new Map<
      string,
      { type: uploadReducer.UploadType; params: unknown }
    >();

    paramsMap.set("yt-1", {
      type: "youtube",
      params: {
        description: "desc",
        privacyStatus: "public",
        thumbnailId: "thumb",
      },
    });

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

    // Exhaust retries to trigger cascade
    for (let i = 0; i < 2; i++) {
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "export-1",
        errorMessage: `Error ${i + 1}`,
      });
      state = reduce(state, { type: "RETRY", uploadId: "export-1" });
    }

    const prev = { ...state.uploads };

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "export-1",
      errorMessage: "Final error",
    });

    expect(state.uploads["yt-1"]!.status).toBe("error");

    simulateEffect(prev, state.uploads, paramsMap, dispatch, abortControllers);

    expect(abortControllers.has("yt-1")).toBe(false);
  });

  it("should recover params for dependency-activated upload from unified param map", () => {
    const dispatched: uploadReducer.Action[] = [];
    const dispatch = (action: uploadReducer.Action) => {
      dispatched.push(action);
    };
    const abortControllers = new Map<string, AbortController>();
    const paramsMap = new Map<
      string,
      { type: uploadReducer.UploadType; params: unknown }
    >();

    const aiHeroParams = {
      body: "article body",
      description: "desc",
      slug: "my-article",
    };
    paramsMap.set("ah-1", { type: "ai-hero", params: aiHeroParams });

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
      uploadId: "ah-1",
      videoId: "video-1",
      title: "AI Hero",
      uploadType: "ai-hero",
      dependsOn: "export-1",
    });

    const prev = { ...state.uploads };

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    simulateEffect(prev, state.uploads, paramsMap, dispatch, abortControllers);

    expect(abortControllers.has("ah-1")).toBe(true);
  });
});

describe("export retry with no stored params", () => {
  it("should retry export type when paramsMap has no entry for the upload", () => {
    const dispatch = vi.fn();
    const abortControllers = new Map<string, AbortController>();
    const paramsMap = new Map<
      string,
      { type: uploadReducer.UploadType; params: unknown }
    >();

    const prev: uploadReducer.State["uploads"] = {
      "exp-1": {
        uploadId: "exp-1",
        videoId: "video-1",
        title: "Export",
        progress: 50,
        status: "uploading",
        uploadType: "export",
        exportStage: "concatenating-clips",
        isBatchEntry: false,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      },
    };

    let state = createState({ uploads: prev });
    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "exp-1",
      errorMessage: "FFmpeg crashed",
    });

    expect(state.uploads["exp-1"]!.status).toBe("retrying");

    simulateEffect(prev, state.uploads, paramsMap, dispatch, abortControllers);

    expect(dispatch).toHaveBeenCalledWith({
      type: "RETRY",
      uploadId: "exp-1",
    });
    expect(abortControllers.has("exp-1")).toBe(true);
  });
});

describe("registry completeness", () => {
  it("should have an entry for every upload type", () => {
    const allTypes: uploadReducer.UploadType[] = [
      "youtube",
      "buffer",
      "ai-hero",
      "skills-changelog",
      "export",
      "dropbox-publish",
      "publish",
    ];

    for (const uploadType of allTypes) {
      const config = uploadTypeRegistry[uploadType];
      expect(config).toBeDefined();
      expect(typeof config.createEntry).toBe("function");
      expect(typeof config.resetEntry).toBe("function");
      expect(typeof config.applySuccess).toBe("function");
      expect(typeof config.initiate).toBe("function");
    }
  });
});

describe("full integration: reducer + registry through lifecycle", () => {
  it("should handle start → error → retry → success with registry-driven entry creation", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "My Upload",
      uploadType: "buffer",
    });

    const started = state.uploads["upload-1"]!;
    expect(started.uploadType).toBe("buffer");
    expect(started.uploadType === "buffer" && started.bufferStage).toBe(
      "uploading-blob"
    );
    expect(started.status).toBe("uploading");

    state = reduce(state, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "upload-1",
      stage: "creating-post",
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Post failed",
    });
    expect(state.uploads["upload-1"]!.status).toBe("retrying");

    state = reduce(state, { type: "RETRY", uploadId: "upload-1" });
    const retried = state.uploads["upload-1"]!;
    expect(retried.status).toBe("uploading");
    expect(retried.uploadType === "buffer" && retried.bufferStage).toBe(
      "uploading-blob"
    );
    expect(retried.progress).toBe(0);

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "upload-1",
    });
    const success = state.uploads["upload-1"]!;
    expect(success.status).toBe("success");
    expect(success.uploadType === "buffer" && success.bufferStage).toBeNull();
  });

  it("should handle dependency chain: export → youtube with type-specific fields via registry", () => {
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
      title: "YouTube Upload",
      dependsOn: "export-1",
    });

    const exportEntry = state.uploads["export-1"]!;
    expect(exportEntry.uploadType === "export" && exportEntry.exportStage).toBe(
      "queued"
    );

    const ytEntry = state.uploads["yt-1"]!;
    expect(ytEntry.status).toBe("waiting");
    expect(ytEntry.uploadType).toBe("youtube");

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "export-1",
      stage: "concatenating-clips",
    });
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    expect(state.uploads["export-1"]!.status).toBe("success");
    expect(state.uploads["yt-1"]!.status).toBe("uploading");

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "yt-1",
      youtubeVideoId: "yt-xyz",
    });

    const ytSuccess = state.uploads["yt-1"]!;
    expect(ytSuccess.status).toBe("success");
    expect(ytSuccess.uploadType === "youtube" && ytSuccess.youtubeVideoId).toBe(
      "yt-xyz"
    );
  });

  it("should preserve dropbox-publish missingVideoCount through the full lifecycle", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "dp-1",
      videoId: "",
      title: "My Course",
      uploadType: "dropbox-publish",
    });

    state = reduce(state, {
      type: "UPDATE_PROGRESS",
      uploadId: "dp-1",
      progress: 60,
    });

    state = reduce(state, {
      type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
      uploadId: "dp-1",
      missingVideoCount: 3,
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "dp-1",
    });

    const success = state.uploads["dp-1"]!;
    expect(success.status).toBe("success");
    expect(success.progress).toBe(100);
    expect(
      success.uploadType === "dropbox-publish" && success.missingVideoCount
    ).toBe(3);
  });

  it("should reset dropbox-publish missingVideoCount on retry", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "dp-1",
      videoId: "",
      title: "My Course",
      uploadType: "dropbox-publish",
    });

    state = reduce(state, {
      type: "UPDATE_DROPBOX_PUBLISH_MISSING_COUNT",
      uploadId: "dp-1",
      missingVideoCount: 5,
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "dp-1",
      errorMessage: "Network error",
    });

    state = reduce(state, { type: "RETRY", uploadId: "dp-1" });

    const retried = state.uploads["dp-1"]!;
    expect(retried.status).toBe("uploading");
    expect(retried.uploadType).toBe("dropbox-publish");
    if (retried.uploadType === "dropbox-publish") {
      expect(retried.missingVideoCount).toBeNull();
    }
  });

  it("should handle publish lifecycle: stages → complete → success preserves newDraftVersionId", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "pub-1",
      videoId: "",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    });

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
      type: "PUBLISH_COMPLETE",
      uploadId: "pub-1",
      newDraftVersionId: "version-42",
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1",
    });

    const success = state.uploads["pub-1"]!;
    expect(success.status).toBe("success");
    if (success.uploadType === "publish") {
      expect(success.newDraftVersionId).toBe("version-42");
      expect(success.courseId).toBe("course-1");
      expect(success.publishStage).toBeNull();
    }
  });
});
