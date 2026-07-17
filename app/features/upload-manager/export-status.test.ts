import { describe, expect, it } from "vitest";
import { hasActiveExportUploads } from "./export-status";
import type { uploadReducer } from "./upload-reducer";

const makeExportEntry = (
  overrides: Partial<uploadReducer.ExportUploadEntry> = {}
): uploadReducer.ExportUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  uploadType: "export",
  exportStage: "queued",
  isBatchEntry: true,
  ...overrides,
});

const makeYouTubeEntry = (
  overrides: Partial<uploadReducer.YouTubeUploadEntry> = {}
): uploadReducer.YouTubeUploadEntry => ({
  uploadId: "yt-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  uploadType: "youtube",
  youtubeVideoId: null,
  ...overrides,
});

describe("hasActiveExportUploads", () => {
  it("returns false for empty uploads", () => {
    expect(hasActiveExportUploads({})).toBe(false);
  });

  it("returns true when an export is uploading", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ status: "uploading" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(true);
  });

  it("returns true when an export is waiting", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ status: "waiting" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(true);
  });

  it("returns true when an export is retrying", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ status: "retrying" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(true);
  });

  it("returns false when all exports are successful", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ uploadId: "upload-1", status: "success" }),
      "upload-2": makeExportEntry({ uploadId: "upload-2", status: "success" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(false);
  });

  it("returns false when all exports have errored", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ status: "error" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(false);
  });

  it("returns true when some exports are done but one is still active", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "upload-1": makeExportEntry({ uploadId: "upload-1", status: "success" }),
      "upload-2": makeExportEntry({
        uploadId: "upload-2",
        status: "uploading",
      }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(true);
  });

  it("ignores non-export upload types", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "yt-1": makeYouTubeEntry({ status: "uploading" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(false);
  });

  it("detects active exports among mixed upload types", () => {
    const uploads: Record<string, uploadReducer.UploadEntry> = {
      "yt-1": makeYouTubeEntry({ status: "success" }),
      "upload-1": makeExportEntry({ status: "uploading" }),
    };
    expect(hasActiveExportUploads(uploads)).toBe(true);
  });
});
