import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandleEditFile } from "./video-posting-layout";

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
