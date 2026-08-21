import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureExportDigest,
  readExportDigest,
  sidecarPath,
  writeExportDigest,
} from "@/services/export-sha256-sidecar";

const SHA = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);

const run = <A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

/** A temp dir with an "export" in it, standing in for FINISHED_VIDEOS_DIRECTORY. */
const makeExport = (contents = "video-bytes") => {
  const dir = mkdtempSync(path.join(tmpdir(), "sidecar-test-"));
  const exportPath = path.join(dir, "course-1-abc123.mp4");
  writeFileSync(exportPath, contents);
  return { dir, exportPath, bytes: Buffer.byteLength(contents) };
};

describe("export sha256 sidecar", () => {
  it("names the sidecar after the export it describes", () => {
    expect(sidecarPath("/out/course-1-abc123.mp4")).toBe(
      "/out/course-1-abc123.mp4.sha256"
    );
  });

  it("round-trips a digest", async () => {
    const { exportPath, bytes } = makeExport();

    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* writeExportDigest(fs, exportPath, {
          sha256: SHA,
          contentHash: CONTENT_HASH,
          bytes,
          durationInSeconds: 12.5,
        });
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toEqual({
      sha256: SHA,
      contentHash: CONTENT_HASH,
      bytes,
      durationInSeconds: 12.5,
    });
  });

  it("reports a cache miss when no sidecar exists", async () => {
    const { exportPath, bytes } = makeExport();

    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toBeNull();
  });

  it("rejects a sidecar whose byte count disagrees with the file on disk", async () => {
    const { exportPath, bytes } = makeExport();

    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* writeExportDigest(fs, exportPath, {
          sha256: SHA,
          contentHash: CONTENT_HASH,
          bytes: bytes + 1,
          durationInSeconds: 12.5,
        });
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toBeNull();
  });

  // A Publish killed mid-write must cost the next one a re-read, never a crash.
  it.each([
    ["torn JSON", '{"sha256":"aaa'],
    ["not an object", '"a string"'],
    [
      "missing contentHash",
      `{"sha256":"${SHA}","bytes":11,"durationInSeconds":12.5}`,
    ],
    [
      "a non-hex sha256",
      `{"sha256":"zzz","contentHash":"${CONTENT_HASH}","bytes":11,"durationInSeconds":12.5}`,
    ],
    [
      "a short sha256",
      `{"sha256":"abc","contentHash":"${CONTENT_HASH}","bytes":11,"durationInSeconds":12.5}`,
    ],
    [
      "a fractional byte count",
      `{"sha256":"${SHA}","contentHash":"${CONTENT_HASH}","bytes":1.5,"durationInSeconds":12.5}`,
    ],
    // Every sidecar written before the truncation check has this shape. It is
    // replaced rather than trusted, so the duration is never simply absent.
    [
      "a sidecar written before durations were recorded",
      `{"sha256":"${SHA}","contentHash":"${CONTENT_HASH}","bytes":11}`,
    ],
    [
      "a non-numeric duration",
      `{"sha256":"${SHA}","contentHash":"${CONTENT_HASH}","bytes":11,"durationInSeconds":"12.5"}`,
    ],
    [
      "a negative duration",
      `{"sha256":"${SHA}","contentHash":"${CONTENT_HASH}","bytes":11,"durationInSeconds":-1}`,
    ],
  ])("treats %s as a cache miss rather than an error", async (_label, raw) => {
    const { exportPath, bytes } = makeExport();
    writeFileSync(sidecarPath(exportPath), raw);

    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toBeNull();
  });

  it("gives an export that has no sidecar a true one", async () => {
    const { exportPath, bytes } = makeExport("video-bytes");

    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* ensureExportDigest(fs, exportPath, 12.5);
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toMatchObject({
      sha256: createHash("sha256").update("video-bytes").digest("hex"),
      bytes,
      durationInSeconds: 12.5,
    });
  });

  it("leaves an export that already has a sound sidecar alone", async () => {
    const { exportPath, bytes } = makeExport();

    // A digest that could not have come from these bytes, so an unconditional
    // re-digest would overwrite it and this assertion would notice.
    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* writeExportDigest(fs, exportPath, {
          sha256: SHA,
          contentHash: CONTENT_HASH,
          bytes,
          durationInSeconds: 12.5,
        });
        yield* ensureExportDigest(fs, exportPath, 99);
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toEqual({
      sha256: SHA,
      contentHash: CONTENT_HASH,
      bytes,
      durationInSeconds: 12.5,
    });
  });

  it("adds a duration to a sound sidecar that predates the truncation check", async () => {
    const { exportPath, bytes } = makeExport();

    // A digest that could not have come from these bytes: if the duration were
    // added by re-reading the file rather than by a rewrite, these would change.
    const read = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* writeExportDigest(fs, exportPath, {
          sha256: SHA,
          contentHash: CONTENT_HASH,
          bytes,
          durationInSeconds: null,
        });
        yield* ensureExportDigest(fs, exportPath, 42);
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toEqual({
      sha256: SHA,
      contentHash: CONTENT_HASH,
      bytes,
      durationInSeconds: 42,
    });
  });

  it("never fails the caller when the export is not there to digest", async () => {
    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* ensureExportDigest(
          fs,
          "/nonexistent-directory-for-test/a.mp4",
          12.5
        );
        return "did not throw";
      })
    );

    expect(result).toBe("did not throw");
  });

  it("never fails the caller when the sidecar cannot be written", async () => {
    const unwritable = path.join(
      "/nonexistent-directory-for-test",
      "course-1-abc123.mp4"
    );

    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* writeExportDigest(fs, unwritable, {
          sha256: SHA,
          contentHash: CONTENT_HASH,
          bytes: 1,
          durationInSeconds: 12.5,
        });
        return "did not throw";
      })
    );

    expect(result).toBe("did not throw");
  });
});
