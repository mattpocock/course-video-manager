import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  deleteVideoFile,
  getVideoFilePath,
  isDefaultEnabled,
  isUrl,
  listVideoFiles,
  readVideoFileString,
  resolveVideoFilePath,
  videoFileExists,
  writeVideoFile,
} from "./video-files";

describe("isUrl", () => {
  it("returns true for https URLs", () => {
    expect(isUrl("https://res.cloudinary.com/test/image.png")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isUrl("http://example.com/file.png")).toBe(true);
  });

  it("returns false for local filenames", () => {
    expect(isUrl("image.png")).toBe(false);
    expect(isUrl("thumbnail-abc.png")).toBe(false);
    expect(isUrl("./relative/path.png")).toBe(false);
    expect(isUrl("/absolute/path.png")).toBe(false);
  });
});

describe("getVideoFilePath", () => {
  it("returns directory path keyed by lineageId when no filename given", () => {
    const result = getVideoFilePath("lineage-abc-123");
    expect(result).toContain("video-files");
    expect(result).toContain("lineage-abc-123");
    expect(result).not.toContain("standalone");
  });

  it("joins local filename with lineageId directory", () => {
    const result = getVideoFilePath("lineage-abc-123", "image.png");
    expect(result).toContain("lineage-abc-123");
    expect(result).toContain("image.png");
  });

  it("returns URL as-is when filename is an https URL", () => {
    const url =
      "https://res.cloudinary.com/total-typescript/image/upload/v1772100428/ai-hero-images/alyzcymusoj0qby2wfhc.png";
    const result = getVideoFilePath("lineage-abc-123", url);
    expect(result).toBe(url);
  });

  it("returns URL as-is when filename is an http URL", () => {
    const url = "http://example.com/image.png";
    const result = getVideoFilePath("lineage-abc-123", url);
    expect(result).toBe(url);
  });
});

/**
 * The store's other half: a RECURSIVE walk, and a containment guard no caller
 * can forget. Both matter beyond this module — a nested file the walk misses is
 * silently absent from the Article Writer's context, which fails quietly rather
 * than loudly.
 */

const LINEAGE = "lineage-1";

let baseDir: string;
let previousBaseDir: string | undefined;

const run = <A, E>(
  effect: Effect.Effect<A, E, NodeContext.NodeContext>
): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const writeFixture = (relativePath: string, contents = "x") => {
  const full = nodePath.join(baseDir, LINEAGE, relativePath);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, contents);
};

// Scoped so the VIDEO_FILES_DIR override cannot leak into the path-derivation
// suites above, which assert against the default "./video-files" base.
describe("the on-disk store", () => {
  beforeEach(() => {
    previousBaseDir = process.env.VIDEO_FILES_DIR;
    baseDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-vf-test-"));
    process.env.VIDEO_FILES_DIR = baseDir;
  });

  afterEach(() => {
    nodeFs.rmSync(baseDir, { recursive: true, force: true });
    if (previousBaseDir === undefined) {
      delete process.env.VIDEO_FILES_DIR;
    } else {
      process.env.VIDEO_FILES_DIR = previousBaseDir;
    }
  });

  describe("listVideoFiles", () => {
    it("returns an empty array when the video has no directory", async () => {
      expect(await run(listVideoFiles("never-created"))).toEqual([]);
    });

    it("lists nested files with relative, POSIX-separated paths", async () => {
      writeFixture("top.md");
      writeFixture("notes/snippet.md");
      writeFixture("notes/deep/inner.ts");

      const entries = await run(listVideoFiles(LINEAGE));

      expect(entries.map((e) => e.path)).toEqual([
        "notes/deep/inner.ts",
        "notes/snippet.md",
        "top.md",
      ]);
    });

    it("skips dotfiles and excluded directories", async () => {
      writeFixture("keep.md");
      writeFixture(".DS_Store");
      writeFixture(".git/config");
      writeFixture("node_modules/pkg/index.js");
      writeFixture(".vite/cache.json");

      const entries = await run(listVideoFiles(LINEAGE));

      expect(entries.map((e) => e.path)).toEqual(["keep.md"]);
    });

    it("reports size and defaultEnabled per entry", async () => {
      writeFixture("code.ts", "hello");
      writeFixture("image.png", "not-really-a-png");

      expect(await run(listVideoFiles(LINEAGE))).toEqual([
        { path: "code.ts", size: 5, defaultEnabled: true },
        { path: "image.png", size: 16, defaultEnabled: false },
      ]);
    });

    it("decides defaultEnabled from the basename, so nesting is irrelevant", () => {
      expect(isDefaultEnabled("notes/snippet.md")).toBe(true);
      expect(isDefaultEnabled("notes/diagram.png")).toBe(false);
      expect(isDefaultEnabled("noextension")).toBe(false);
    });
  });

  describe("resolveVideoFilePath", () => {
    const expectRejected = async (input: string) => {
      const result = await Effect.runPromise(
        Effect.either(resolveVideoFilePath(LINEAGE, input))
      );
      expect(
        result._tag,
        `expected ${JSON.stringify(input)} to be rejected`
      ).toBe("Left");
    };

    it("accepts a nested relative path", async () => {
      expect(
        await Effect.runPromise(
          resolveVideoFilePath(LINEAGE, "notes/snippet.md")
        )
      ).toBe(nodePath.resolve(baseDir, LINEAGE, "notes/snippet.md"));
    });

    it("rejects paths that escape the video's directory", async () => {
      await expectRejected("../elsewhere.md");
      await expectRejected("notes/../../elsewhere.md");
      await expectRejected(nodePath.join(baseDir, "absolute.md"));
      await expectRejected("");
      await expectRejected(".");
    });
  });

  describe("writeVideoFile / deleteVideoFile", () => {
    it("creates missing parent directories on write", async () => {
      await run(writeVideoFile(LINEAGE, "notes/deep/snippet.md", "hello"));

      expect(
        await run(readVideoFileString(LINEAGE, "notes/deep/snippet.md"))
      ).toBe("hello");
    });

    it("unlinks the file but leaves its parent directory", async () => {
      writeFixture("notes/snippet.md");

      await run(deleteVideoFile(LINEAGE, "notes/snippet.md"));

      expect(await run(videoFileExists(LINEAGE, "notes/snippet.md"))).toBe(
        false
      );
      expect(nodeFs.existsSync(nodePath.join(baseDir, LINEAGE, "notes"))).toBe(
        true
      );
    });
  });
});
