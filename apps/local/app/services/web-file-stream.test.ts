import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webFileStream } from "./web-file-stream.server";

/**
 * What is actually being pinned here is a TYPE, at runtime.
 *
 * The crash this module exists to stop is a race one microtask wide, inside
 * `undici` (see the module's own comment). A test cannot reliably lose that
 * race — a standalone harness needed a couple of hundred cancelled requests to
 * see it, and under Vitest's scheduling it does not reproduce at all.
 *
 * Its PRECONDITION is dead simple, though: `undici` only reaches for the
 * broken async-iterable wrapper when the body it was handed is not already a
 * `ReadableStream`. So that is the assertion — the thing this function hands a
 * `Response` is a real web stream, and the `as any` cast that used to sit at
 * every one of these call sites is gone for good. Return a Node stream from
 * `webFileStream` and the first test here fails.
 */

const BYTES = "abcdefghij";

let dir: string;
let filePath: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "web-file-stream-"));
  filePath = path.join(dir, "speech.wav");
  writeFileSync(filePath, BYTES);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("webFileStream", () => {
  it("is a real web ReadableStream, so undici never wraps it", () => {
    expect(webFileStream(filePath)).toBeInstanceOf(ReadableStream);
  });

  it("is still a real web ReadableStream for a byte window", () => {
    expect(webFileStream(filePath, { start: 2, end: 4 })).toBeInstanceOf(
      ReadableStream
    );
  });

  it("is a body a Response accepts with no cast at all", async () => {
    const response = new Response(webFileStream(filePath));
    await expect(response.text()).resolves.toBe(BYTES);
  });

  it("sends exactly the bytes of the window, both ends inclusive", async () => {
    const response = new Response(
      webFileStream(filePath, { start: 2, end: 4 })
    );
    await expect(response.text()).resolves.toBe("cde");
  });

  it("closes the file when the reader gives up part way through", async () => {
    // A browser abandoning a request is the normal case, not the exception:
    // the Animatic cancels a WAV the moment the scrub bar moves. The handle has
    // to go back, and the cancel itself must not throw.
    const stream = webFileStream(filePath);
    const reader = stream.getReader();

    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});
