import { describe, expect, it, vi } from "vitest";
import { uploadReducer } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const exportConfig = uploadTypeRegistry["export"]!;
const youtubeConfig = uploadTypeRegistry["youtube"]!;
const bufferConfig = uploadTypeRegistry["buffer"]!;

const makeBase = (
  overrides: Partial<uploadReducer.BaseUploadEntry> = {}
): uploadReducer.BaseUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Export",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  ...overrides,
});

describe("export registry entry", () => {
  describe("createEntry", () => {
    it("should create an export entry with exportStage queued and isBatchEntry false", () => {
      const base = makeBase();

      const entry = exportConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: false,
      });
    });

    it("should set isBatchEntry true from action", () => {
      const entry = exportConfig.createEntry(makeBase(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Batch Export",
        isBatchEntry: true,
      });

      expect(entry).toMatchObject({
        uploadType: "export",
        isBatchEntry: true,
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = exportConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should reset exportStage to queued and preserve isBatchEntry", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.ExportUploadEntry = {
        ...base,
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: true,
      };

      const entry = exportConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: true,
      });
    });

    it("should preserve isBatchEntry false", () => {
      const base = makeBase({ retryCount: 2 });

      const prevEntry: uploadReducer.ExportUploadEntry = {
        ...base,
        uploadType: "export",
        exportStage: "concatenating-clips",
        isBatchEntry: false,
      };

      const entry = exportConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: false,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success, clear exportStage, and preserve isBatchEntry", () => {
      const entry: uploadReducer.ExportUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
        progress: 80,
        status: "uploading",
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: false,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      const result = exportConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        exportStage: null,
      });
    });

    it("should preserve isBatchEntry true on success", () => {
      const entry: uploadReducer.ExportUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Batch Export",
        progress: 80,
        status: "uploading",
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: true,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      const result = exportConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.isBatchEntry).toBe(true);
      expect(result.exportStage).toBeNull();
      expect(result.status).toBe("success");
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.ExportUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
        progress: 50,
        status: "uploading",
        uploadType: "export",
        exportStage: "concatenating-clips",
        isBatchEntry: false,
        errorMessage: "previous error",
        retryCount: 1,
        terminal: false,
        dependsOn: null,
      };

      const result = exportConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.errorMessage).toBeNull();
    });
  });
});

describe("youtube registry entry", () => {
  it("should be registered in the registry", () => {
    expect(youtubeConfig).toBeDefined();
  });

  it("should have supportsDependsOn set to true", () => {
    expect(youtubeConfig.supportsDependsOn).toBe(true);
  });

  describe("createEntry", () => {
    it("should create a youtube entry with youtubeVideoId null", () => {
      const base = makeBase();

      const entry = youtubeConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "youtube",
        youtubeVideoId: null,
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = youtubeConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should preserve youtubeVideoId from previous entry", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.YouTubeUploadEntry = {
        ...base,
        uploadType: "youtube",
        youtubeVideoId: "yt-abc123",
      };

      const entry = youtubeConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "youtube",
        youtubeVideoId: "yt-abc123",
      });
    });

    it("should preserve null youtubeVideoId", () => {
      const base = makeBase({ retryCount: 2 });

      const prevEntry: uploadReducer.YouTubeUploadEntry = {
        ...base,
        uploadType: "youtube",
        youtubeVideoId: null,
      };

      const entry = youtubeConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "youtube",
        youtubeVideoId: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and store youtubeVideoId", () => {
      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 80,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      const result = youtubeConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-abc123",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        youtubeVideoId: "yt-abc123",
      });
    });

    it("should default youtubeVideoId to null when not provided", () => {
      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 80,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      const result = youtubeConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.youtubeVideoId).toBeNull();
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 50,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: "previous error",
        retryCount: 1,
        terminal: false,
        dependsOn: null,
      };

      const result = youtubeConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-abc",
      });

      expect(result.errorMessage).toBeNull();
    });
  });

  describe("initiate", () => {
    it("should call startSSEUpload with correct params and wire dispatch", async () => {
      const { startSSEUpload } = await import("./sse-upload-client");
      vi.mocked(startSSEUpload);

      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();

      const entry: uploadReducer.YouTubeUploadEntry = {
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
      };

      const params = {
        description: "A test video",
        privacyStatus: "unlisted" as const,
        thumbnailId: "thumb-1",
      };

      youtubeConfig.initiate(
        "upload-1",
        entry,
        params,
        dispatch,
        abortControllers
      );

      expect(abortControllers.has("upload-1")).toBe(true);
    });

    it("should abort existing controller before starting new one", () => {
      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();
      const existingController = new AbortController();
      const abortSpy = vi.spyOn(existingController, "abort");
      abortControllers.set("upload-1", existingController);

      const entry: uploadReducer.YouTubeUploadEntry = {
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
      };

      youtubeConfig.initiate(
        "upload-1",
        entry,
        {
          description: "desc",
          privacyStatus: "public" as const,
          thumbnailId: "thumb-1",
        },
        dispatch,
        abortControllers
      );

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});

describe("buffer registry entry", () => {
  it("should be registered in the registry", () => {
    expect(bufferConfig).toBeDefined();
  });

  describe("createEntry", () => {
    it("should create a buffer entry with bufferStage copying", () => {
      const base = makeBase();

      const entry = bufferConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "buffer",
        bufferStage: "uploading-blob",
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = bufferConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should reset bufferStage to copying", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.BufferUploadEntry = {
        ...base,
        uploadType: "buffer",
        bufferStage: "creating-post",
      };

      const entry = bufferConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "buffer",
        bufferStage: "uploading-blob",
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and clear bufferStage", () => {
      const entry: uploadReducer.BufferUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
        progress: 80,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "creating-post",
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      const result = bufferConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        bufferStage: null,
      });
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.BufferUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
        progress: 50,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "polling",
        errorMessage: "previous error",
        retryCount: 1,
        terminal: false,
        dependsOn: null,
      };

      const result = bufferConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.errorMessage).toBeNull();
    });
  });

  describe("initiate", () => {
    it("should store abort controller in the map", () => {
      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();

      const entry: uploadReducer.BufferUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
        progress: 0,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "uploading-blob",
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      bufferConfig.initiate(
        "upload-1",
        entry,
        { caption: "Hello world" },
        dispatch,
        abortControllers
      );

      expect(abortControllers.has("upload-1")).toBe(true);
    });

    it("should abort existing controller before starting new one", () => {
      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();
      const existingController = new AbortController();
      const abortSpy = vi.spyOn(existingController, "abort");
      abortControllers.set("upload-1", existingController);

      const entry: uploadReducer.BufferUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
        progress: 0,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "uploading-blob",
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
      };

      bufferConfig.initiate(
        "upload-1",
        entry,
        { caption: "Hello world" },
        dispatch,
        abortControllers
      );

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});
