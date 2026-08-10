import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";

const FAKE_UPLOAD_URI =
  "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc123";

let capturedFetchCalls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  capturedFetchCalls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      capturedFetchCalls.push({ url, init });

      // Initiation request (POST with JSON content type)
      if (init.method === "POST") {
        return new Response(null, {
          status: 200,
          headers: { Location: FAKE_UPLOAD_URI },
        });
      }

      // Chunk upload (PUT) — return complete immediately
      return new Response(JSON.stringify({ id: "yt-video-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("uploadVideoToYouTube", () => {
  it("includes notifySubscribers=false in the initiation URL when set", async () => {
    const { uploadVideoToYouTube } = await import("./youtube-upload-service");

    const tmpFile = "/tmp/test-video.mp4";
    const fs = await import("fs");
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));

    try {
      await uploadVideoToYouTube({
        accessToken: "fake-token",
        filePath: tmpFile,
        title: "Test Short",
        description: "A test short",
        privacyStatus: "public",
        notifySubscribers: false,
        onProgress: () => {},
      }).pipe(Effect.runPromise);

      const initiationCall = capturedFetchCalls[0]!;
      const url = new URL(initiationCall.url);
      expect(url.searchParams.get("notifySubscribers")).toBe("false");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("includes notifySubscribers=true in the initiation URL when set", async () => {
    const { uploadVideoToYouTube } = await import("./youtube-upload-service");

    const tmpFile = "/tmp/test-video-default.mp4";
    const fs = await import("fs");
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));

    try {
      await uploadVideoToYouTube({
        accessToken: "fake-token",
        filePath: tmpFile,
        title: "Test Video",
        description: "A test video",
        privacyStatus: "public",
        notifySubscribers: true,
        onProgress: () => {},
      }).pipe(Effect.runPromise);

      const initiationCall = capturedFetchCalls[0]!;
      const url = new URL(initiationCall.url);
      expect(url.searchParams.get("notifySubscribers")).toBe("true");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
