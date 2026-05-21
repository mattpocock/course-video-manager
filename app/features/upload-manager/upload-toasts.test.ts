import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";
import { showSuccessToast } from "./upload-toasts";
import type { uploadReducer } from "./upload-reducer";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

function makeYouTubeUpload(
  overrides?: Partial<uploadReducer.YouTubeUploadEntry>
): uploadReducer.YouTubeUploadEntry {
  return {
    uploadId: "u1",
    videoId: "v1",
    title: "Test Video",
    progress: 100,
    status: "success",
    errorMessage: null,
    retryCount: 0,
    dependsOn: null,
    uploadType: "youtube",
    youtubeVideoId: "yt-123",
    ...overrides,
  };
}

describe("showSuccessToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("youtube upload", () => {
    it("should copy the YouTube Studio link to clipboard", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      showSuccessToast(makeYouTubeUpload());

      const call = vi.mocked(toast.success).mock.calls[0]!;
      expect(call[0]).toBe('"Test Video" uploaded to YouTube');

      const opts = call[1] as {
        action: { label: string; onClick: () => void };
      };
      expect(opts.action.label).toBe("Copy YouTube Studio Link");

      opts.action.onClick();

      expect(writeText).toHaveBeenCalledWith(
        "https://studio.youtube.com/video/yt-123/edit"
      );
    });

    it("should omit the copy action when youtubeVideoId is null", () => {
      showSuccessToast(makeYouTubeUpload({ youtubeVideoId: null }));

      const call = vi.mocked(toast.success).mock.calls[0]!;
      const opts = call[1] as { action: unknown };
      expect(opts.action).toBeUndefined();
    });
  });
});
