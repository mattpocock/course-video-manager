import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clipMockupAssetContentType,
  clipMockupAssetResponse,
} from "./clip-mockup-asset-response.server";
import {
  CLIP_MOCKUP_DIR_ENV_KEY,
  resolveClipMockupPath,
} from "./clip-mockup-files";

/**
 * The Animatic route itself is view code over a loader and has no test seam of
 * its own (#1649 says so). THIS does: the route that hands a Clip Mockup's
 * frame and its speech to the browser is the first thing in this app to serve
 * `audio/*`, and an audio response whose Range headers are subtly wrong does
 * not fail loudly — it silently refuses to seek, which looks like a player
 * bug. The arithmetic is worth pinning.
 */

const ALPHABET = "abcdefghij"; // ten bytes, so offsets are readable

let dir: string;
let filePath: string;

const request = (range?: string) =>
  new Request("http://localhost/asset", {
    headers: range ? { range } : undefined,
  });

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "clip-mockup-asset-"));
  filePath = path.join(dir, "speech.wav");
  writeFileSync(filePath, ALPHABET);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("clipMockupAssetContentType", () => {
  it("serves a WAV as audio/wav", () => {
    // The whole reason this module exists: `api.video-files.read.ts`'s mime
    // map has no audio entries, so a WAV through it is octet-stream.
    expect(clipMockupAssetContentType("a/b/speech.wav")).toBe("audio/wav");
  });

  it("serves a frame as image/png, case-insensitively", () => {
    expect(clipMockupAssetContentType("frame.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for anything unknown", () => {
    expect(clipMockupAssetContentType("frame.qqq")).toBe(
      "application/octet-stream"
    );
  });
});

describe("clipMockupAssetResponse", () => {
  it("sends the whole file, and advertises Range support, when none is asked for", async () => {
    const response = clipMockupAssetResponse(filePath, request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    await expect(response.text()).resolves.toBe(ALPHABET);
  });

  it("answers a closed range with 206 and exactly those bytes", async () => {
    const response = clipMockupAssetResponse(filePath, request("bytes=2-4"));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(response.headers.get("Content-Length")).toBe("3");
    await expect(response.text()).resolves.toBe("cde");
  });

  it("answers an open-ended range with the rest of the file", async () => {
    const response = clipMockupAssetResponse(filePath, request("bytes=7-"));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 7-9/10");
    await expect(response.text()).resolves.toBe("hij");
  });

  it("answers a suffix range with the last N bytes", async () => {
    const response = clipMockupAssetResponse(filePath, request("bytes=-3"));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 7-9/10");
    await expect(response.text()).resolves.toBe("hij");
  });

  it("clamps an end past the file rather than over-reading", async () => {
    const response = clipMockupAssetResponse(filePath, request("bytes=8-99"));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 8-9/10");
    await expect(response.text()).resolves.toBe("ij");
  });

  it("refuses a range that starts past the end with 416", () => {
    const response = clipMockupAssetResponse(filePath, request("bytes=50-60"));

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("reports a missing file as 404 rather than streaming nothing", () => {
    const response = clipMockupAssetResponse(
      path.join(dir, "gone.wav"),
      request()
    );

    expect(response.status).toBe(404);
  });
});

describe("path containment", () => {
  // The asset route takes a Clip Mockup id, never a path — but the path it
  // resolves comes out of a DB column, and this is the guard that stops a
  // stored `../../` from reading the rest of the disk.
  const run = (relativePath: string) =>
    Effect.runSync(
      resolveClipMockupPath("lineage-1", relativePath).pipe(
        Effect.map((p) => ({ ok: true as const, path: p })),
        Effect.catchTag("InvalidClipMockupPathError", (e) =>
          Effect.succeed({ ok: false as const, message: e.message })
        )
      )
    );

  let previous: string | undefined;

  beforeAll(() => {
    previous = process.env[CLIP_MOCKUP_DIR_ENV_KEY];
    const base = path.join(dir, "store");
    mkdirSync(base, { recursive: true });
    process.env[CLIP_MOCKUP_DIR_ENV_KEY] = base;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env[CLIP_MOCKUP_DIR_ENV_KEY];
    else process.env[CLIP_MOCKUP_DIR_ENV_KEY] = previous;
  });

  it("resolves a path inside the Video's own directory", () => {
    const result = run("frame.png");
    expect(result.ok).toBe(true);
  });

  it("refuses a path that escapes it", () => {
    const result = run("../../etc/passwd");
    expect(result).toEqual({
      ok: false,
      message: "path escapes the Clip Mockup directory",
    });
  });

  it("refuses an absolute path", () => {
    const result = run("/etc/passwd");
    expect(result.ok).toBe(false);
  });
});
