import { describe, expect, it, vi } from "vitest";
import { uploadReducer } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const dropboxPublishConfig = uploadTypeRegistry["dropbox-publish"]!;
const publishConfig = uploadTypeRegistry["publish"]!;

const makeBase = (
  overrides: Partial<uploadReducer.BaseUploadEntry> = {}
): uploadReducer.BaseUploadEntry => ({
  uploadId: "upload-1",
  videoId: "",
  title: "My Course",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  ...overrides,
});

describe("dropbox-publish registry entry", () => {
  it("should be registered in the registry", () => {
    expect(dropboxPublishConfig).toBeDefined();
  });

  it("should have supportsDependsOn set to false", () => {
    expect(dropboxPublishConfig.supportsDependsOn).toBe(false);
  });

  describe("createEntry", () => {
    it("should create a dropbox-publish entry with missingVideoCount null", () => {
      const base = makeBase();

      const entry = dropboxPublishConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "",
        title: "My Course",
        uploadType: "dropbox-publish",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      });
    });
  });

  describe("resetEntry", () => {
    it("should reset missingVideoCount to null", () => {
      const base = makeBase({ errorMessage: "some error", retryCount: 1 });
      const prevEntry: uploadReducer.DropboxPublishUploadEntry = {
        ...base,
        uploadType: "dropbox-publish",
        missingVideoCount: 5,
      };

      const entry = dropboxPublishConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      });
    });

    it("should preserve null missingVideoCount", () => {
      const base = makeBase({ retryCount: 2 });
      const prevEntry: uploadReducer.DropboxPublishUploadEntry = {
        ...base,
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      };

      const entry = dropboxPublishConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and preserve missingVideoCount", () => {
      const entry: uploadReducer.DropboxPublishUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "dropbox-publish",
        missingVideoCount: 3,
      };

      const result = dropboxPublishConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        missingVideoCount: 3,
      });
    });

    it("should preserve null missingVideoCount on success", () => {
      const entry: uploadReducer.DropboxPublishUploadEntry = {
        ...makeBase({ progress: 80 }),
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      };

      const result = dropboxPublishConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.missingVideoCount).toBeNull();
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.DropboxPublishUploadEntry = {
        ...makeBase({
          progress: 50,
          errorMessage: "previous error",
          retryCount: 1,
        }),
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      };

      const result = dropboxPublishConfig.applySuccess(entry, {
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
      const entry: uploadReducer.DropboxPublishUploadEntry = {
        ...makeBase(),
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      };

      dropboxPublishConfig.initiate(
        "upload-1",
        entry,
        { repoId: "repo-1" },
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

      const entry: uploadReducer.DropboxPublishUploadEntry = {
        ...makeBase(),
        uploadType: "dropbox-publish",
        missingVideoCount: null,
      };

      dropboxPublishConfig.initiate(
        "upload-1",
        entry,
        { repoId: "repo-1" },
        dispatch,
        abortControllers
      );

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});

describe("publish registry entry", () => {
  it("should be registered in the registry", () => {
    expect(publishConfig).toBeDefined();
  });

  it("should have supportsDependsOn set to false", () => {
    expect(publishConfig.supportsDependsOn).toBe(false);
  });

  describe("createEntry", () => {
    it("should create a publish entry with publishStage validating and courseId from action", () => {
      const base = makeBase();

      const entry = publishConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "",
        title: "My Course",
        uploadType: "publish",
        courseId: "course-1",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "publish",
        publishStage: "validating",
        newDraftVersionId: null,
        courseId: "course-1",
      });
    });

    it("should default courseId to empty string when not provided", () => {
      const base = makeBase();

      const entry = publishConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "",
        title: "My Course",
        uploadType: "publish",
      });

      expect(entry.courseId).toBe("");
    });
  });

  describe("resetEntry", () => {
    it("should reset publishStage to validating and newDraftVersionId to null, preserve courseId", () => {
      const base = makeBase({ errorMessage: "some error", retryCount: 1 });
      const prevEntry: uploadReducer.PublishUploadEntry = {
        ...base,
        uploadType: "publish",
        publishStage: "freezing",
        newDraftVersionId: "version-1",
        courseId: "course-1",
      };

      const entry = publishConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "publish",
        publishStage: "validating",
        newDraftVersionId: null,
        courseId: "course-1",
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and preserve publishStage null, newDraftVersionId, and courseId", () => {
      const entry: uploadReducer.PublishUploadEntry = {
        ...makeBase({ progress: 90 }),
        uploadType: "publish",
        publishStage: null,
        newDraftVersionId: "version-2",
        courseId: "course-1",
      };

      const result = publishConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        publishStage: null,
        newDraftVersionId: "version-2",
        courseId: "course-1",
      });
    });

    it("should clear previous error message on success", () => {
      const entry: uploadReducer.PublishUploadEntry = {
        ...makeBase({
          progress: 50,
          errorMessage: "previous error",
          retryCount: 1,
        }),
        uploadType: "publish",
        publishStage: "uploading",
        newDraftVersionId: null,
        courseId: "course-1",
      };

      const result = publishConfig.applySuccess(entry, {
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
      const entry: uploadReducer.PublishUploadEntry = {
        ...makeBase(),
        uploadType: "publish",
        publishStage: "validating",
        newDraftVersionId: null,
        courseId: "course-1",
      };

      publishConfig.initiate(
        "upload-1",
        entry,
        { courseId: "course-1", name: "v1", description: "First release" },
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

      const entry: uploadReducer.PublishUploadEntry = {
        ...makeBase(),
        uploadType: "publish",
        publishStage: "validating",
        newDraftVersionId: null,
        courseId: "course-1",
      };

      publishConfig.initiate(
        "upload-1",
        entry,
        { courseId: "course-1", name: "v1", description: "First release" },
        dispatch,
        abortControllers
      );

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});
