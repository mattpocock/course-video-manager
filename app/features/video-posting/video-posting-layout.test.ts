import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileMetadata } from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import {
  createInitialEnabledFiles,
  createInitialEnabledSections,
  createHandleFileClick,
  createHandleEditFile,
  createHandleDeleteFile,
} from "./video-posting-layout";

describe("createInitialEnabledFiles", () => {
  it("includes only files with defaultEnabled true", () => {
    const files: FileMetadata[] = [
      { path: "notes.md", size: 100, defaultEnabled: true },
      { path: "draft.md", size: 200, defaultEnabled: false },
      { path: "code.ts", size: 300, defaultEnabled: true },
    ];
    const result = createInitialEnabledFiles(files);
    expect(result).toEqual(new Set(["notes.md", "code.ts"]));
  });

  it("returns empty set when no files are defaultEnabled", () => {
    const files: FileMetadata[] = [
      { path: "a.md", size: 50, defaultEnabled: false },
    ];
    expect(createInitialEnabledFiles(files)).toEqual(new Set());
  });

  it("returns empty set for empty files array", () => {
    expect(createInitialEnabledFiles([])).toEqual(new Set());
  });
});

describe("createInitialEnabledSections", () => {
  it("includes all chapter ids", () => {
    const chapters: SectionWithWordCount[] = [
      { id: "ch-1", name: "Intro", order: "a0", wordCount: 100 },
      { id: "ch-2", name: "Body", order: "a1", wordCount: 200 },
    ];
    const result = createInitialEnabledSections(chapters);
    expect(result).toEqual(new Set(["ch-1", "ch-2"]));
  });

  it("returns empty set for empty chapters array", () => {
    expect(createInitialEnabledSections([])).toEqual(new Set());
  });
});

describe("createHandleFileClick", () => {
  it("sets preview file path and opens modal", () => {
    const setPreviewFilePath = vi.fn();
    const setIsPreviewModalOpen = vi.fn();
    const handler = createHandleFileClick(
      setPreviewFilePath,
      setIsPreviewModalOpen
    );

    handler("/path/to/file.md");

    expect(setPreviewFilePath).toHaveBeenCalledWith("/path/to/file.md");
    expect(setIsPreviewModalOpen).toHaveBeenCalledWith(true);
  });
});

describe("createHandleDeleteFile", () => {
  it("sets file to delete and opens delete modal", () => {
    const setFileToDelete = vi.fn();
    const setIsDeleteModalOpen = vi.fn();
    const handler = createHandleDeleteFile(
      setFileToDelete,
      setIsDeleteModalOpen
    );

    handler("notes.md");

    expect(setFileToDelete).toHaveBeenCalledWith("notes.md");
    expect(setIsDeleteModalOpen).toHaveBeenCalledWith(true);
  });
});

describe("createHandleEditFile", () => {
  const mockFetch =
    vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches file content and opens management modal on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("file content here"),
    } as Response);

    const setSelectedFilename = vi.fn();
    const setSelectedFileContent = vi.fn();
    const setIsFileModalOpen = vi.fn();
    const handler = createHandleEditFile("video-123", {
      setSelectedFilename,
      setSelectedFileContent,
      setIsFileModalOpen,
    });

    await handler("notes.md");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/standalone-files/read?videoId=video-123&filename=notes.md"
    );
    expect(setSelectedFilename).toHaveBeenCalledWith("notes.md");
    expect(setSelectedFileContent).toHaveBeenCalledWith("file content here");
    expect(setIsFileModalOpen).toHaveBeenCalledWith(true);
  });

  it("does not open modal when fetch response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve(""),
    } as Response);

    const setSelectedFilename = vi.fn();
    const setSelectedFileContent = vi.fn();
    const setIsFileModalOpen = vi.fn();
    const handler = createHandleEditFile("video-123", {
      setSelectedFilename,
      setSelectedFileContent,
      setIsFileModalOpen,
    });

    await handler("notes.md");

    expect(setIsFileModalOpen).not.toHaveBeenCalled();
  });

  it("does not open modal when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const setSelectedFilename = vi.fn();
    const setSelectedFileContent = vi.fn();
    const setIsFileModalOpen = vi.fn();
    const handler = createHandleEditFile("video-123", {
      setSelectedFilename,
      setSelectedFileContent,
      setIsFileModalOpen,
    });

    await handler("notes.md");

    expect(setIsFileModalOpen).not.toHaveBeenCalled();
  });

  it("encodes filename with special characters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("content"),
    } as Response);

    const handler = createHandleEditFile("video-123", {
      setSelectedFilename: vi.fn(),
      setSelectedFileContent: vi.fn(),
      setIsFileModalOpen: vi.fn(),
    });

    await handler("my file (1).md");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/standalone-files/read?videoId=video-123&filename=my%20file%20(1).md"
    );
  });
});
