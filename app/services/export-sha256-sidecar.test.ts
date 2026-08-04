import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
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
        });
        return yield* readExportDigest(fs, exportPath, bytes);
      })
    );

    expect(read).toEqual({
      sha256: SHA,
      contentHash: CONTENT_HASH,
      bytes,
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
    ["missing contentHash", `{"sha256":"${SHA}","bytes":11}`],
    [
      "a non-hex sha256",
      `{"sha256":"zzz","contentHash":"${CONTENT_HASH}","bytes":11}`,
    ],
    [
      "a short sha256",
      `{"sha256":"abc","contentHash":"${CONTENT_HASH}","bytes":11}`,
    ],
    [
      "a fractional byte count",
      `{"sha256":"${SHA}","contentHash":"${CONTENT_HASH}","bytes":1.5}`,
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
        });
        return "did not throw";
      })
    );

    expect(result).toBe("did not throw");
  });
});
