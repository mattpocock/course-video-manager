import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { SystemError } from "@effect/platform/Error";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { FileSystem } from "@effect/platform";
import {
  copyVideoFilesDirectory,
  deleteVideoFile,
  getVideoFilePath,
  isDefaultEnabled,
  isUrl,
  listVideoFiles,
  locateStoredVideoFile,
  readVideoFileString,
  removeStoredVideoFile,
  resolveVideoFilePath,
  videoFileExists,
  videoFileRelativePathOf,
  videoFileRowPath,
  writeVideoFile,
} from "./video-files";

describe("isUrl", () => {
  it("returns true for https URLs", () => {
    expect(isUrl("https://res.cloudinary.com/test/image.png")).toBe(true);
  });

  it("returns false for local filenames", () => {
    expect(isUrl("image.png")).toBe(false);
    expect(isUrl("thumbnail-abc.png")).toBe(false);
    expect(isUrl("./relative/path.png")).toBe(false);
    expect(isUrl("/absolute/path.png")).toBe(false);
  });
});

/**
 * Every test runs on two temp Storage Roots (D: and E: stand-ins) and an
 * empty legacy store; `baseDir` is `video-files/` on the first root, where
 * new files are written.
 */
let rootD: string;
let rootE: string;
let legacyDir: string;
let baseDir: string;
const previous = {
  STORAGE_ROOTS: process.env.STORAGE_ROOTS,
  VIDEO_FILES_DIR: process.env.VIDEO_FILES_DIR,
};

beforeEach(() => {
  const tmp = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-vf-test-"));
  rootD = nodePath.join(tmp, "d");
  rootE = nodePath.join(tmp, "e");
  legacyDir = nodePath.join(tmp, "legacy");
  for (const dir of [rootD, rootE, legacyDir]) nodeFs.mkdirSync(dir);
  baseDir = nodePath.join(rootD, "video-files");
  process.env.STORAGE_ROOTS = `${rootD},${rootE}`;
  process.env.VIDEO_FILES_DIR = legacyDir;
});

afterEach(() => {
  nodeFs.rmSync(nodePath.dirname(rootD), { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getVideoFilePath", () => {
  it("is the Video's directory in video-files/ on the first Storage Root", () => {
    expect(getVideoFilePath("lineage-abc-123")).toBe(
      nodePath.join(rootD, "video-files", "lineage-abc-123")
    );
  });

  it("returns URL as-is when filename is an https URL", () => {
    const url =
      "https://res.cloudinary.com/total-typescript/image/upload/v1772100428/ai-hero-images/alyzcymusoj0qby2wfhc.png";
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

const run = <A, E>(
  effect: Effect.Effect<A, E, NodeContext.NodeContext>
): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const writeIn = (store: string, relativePath: string, contents = "x") => {
  const full = nodePath.join(store, LINEAGE, relativePath);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, contents);
  return full;
};

const writeFixture = (relativePath: string, contents = "x") =>
  writeIn(baseDir, relativePath, contents);

describe("across Storage Roots and the legacy store", () => {
  const onE = () => nodePath.join(rootE, "video-files");

  it("lists and reads a Video's files wherever they are, the first store winning", async () => {
    writeIn(onE(), "notes.md", "on E");
    writeIn(legacyDir, "old.md", "legacy");
    writeIn(legacyDir, "notes.md", "stale legacy copy");

    expect((await run(listVideoFiles(LINEAGE))).map((e) => e.path)).toEqual([
      "notes.md",
      "old.md",
    ]);
    expect(await run(readVideoFileString(LINEAGE, "notes.md"))).toBe("on E");
    expect(await run(readVideoFileString(LINEAGE, "old.md"))).toBe("legacy");
  });

  it("writes a new file on the first root and removes its older copies", async () => {
    const legacy = writeIn(legacyDir, "notes.md", "old");

    const written = await run(writeVideoFile(LINEAGE, "notes.md", "new"));

    expect(written).toBe(nodePath.join(baseDir, LINEAGE, "notes.md"));
    expect(nodeFs.existsSync(legacy)).toBe(false);
    expect(await run(readVideoFileString(LINEAGE, "notes.md"))).toBe("new");
  });

  it("deletes every copy of a file", async () => {
    const legacy = writeIn(legacyDir, "notes.md");
    const e = writeIn(onE(), "notes.md");

    await run(deleteVideoFile(LINEAGE, "notes.md"));

    expect(nodeFs.existsSync(legacy)).toBe(false);
    expect(nodeFs.existsSync(e)).toBe(false);
  });

  it("stores a Thumbnail's path relative to its Storage Root and finds it on any root", () => {
    const row = videoFileRowPath(LINEAGE, "thumbnail-1.png");
    expect(row).toBe(`video-files/${LINEAGE}/thumbnail-1.png`);
    expect(locateStoredVideoFile(row)).toBeNull();

    const e = writeIn(onE(), "thumbnail-1.png");
    expect(locateStoredVideoFile(row)).toBe(e);

    // An old checkout-relative row, before the relocation: the legacy store.
    const old = writeIn(legacyDir, "thumbnail-3.png");
    expect(
      locateStoredVideoFile(videoFileRowPath(LINEAGE, "thumbnail-3.png"))
    ).toBe(old);

    // A legacy absolute path is read where it is.
    const legacy = writeIn(legacyDir, "thumbnail-2.png");
    expect(locateStoredVideoFile(legacy)).toBe(legacy);
  });

  it("knows a stored path's file in the Video's directory, and nothing outside any store", () => {
    expect(
      videoFileRelativePathOf(`video-files/${LINEAGE}/thumbnail-1.png`, LINEAGE)
    ).toBe("thumbnail-1.png");
    expect(
      videoFileRelativePathOf(
        nodePath.join(legacyDir, LINEAGE, "thumbnail-1.png"),
        LINEAGE
      )
    ).toBe("thumbnail-1.png");
    expect(
      videoFileRelativePathOf(
        `/home/matt/repo/.worktrees/x/video-files/${LINEAGE}/thumbnail-1.png`,
        LINEAGE
      )
    ).toBeNull();
    expect(
      videoFileRelativePathOf(`video-files/other/thumbnail-1.png`, LINEAGE)
    ).toBeNull();
  });

  it("removes a stored path's file on every root, and never a file in no store", async () => {
    const row = videoFileRowPath(LINEAGE, "thumbnail-1.png");
    const d = writeFixture("thumbnail-1.png");
    const e = writeIn(onE(), "thumbnail-1.png");
    const outside = nodePath.join(nodePath.dirname(rootD), "matts-file.png");
    nodeFs.writeFileSync(outside, "x");

    await run(
      Effect.flatMap(FileSystem.FileSystem, (fs) =>
        Effect.all([
          removeStoredVideoFile(fs, row),
          removeStoredVideoFile(fs, outside),
        ])
      )
    );

    expect(nodeFs.existsSync(d)).toBe(false);
    expect(nodeFs.existsSync(e)).toBe(false);
    expect(nodeFs.existsSync(outside)).toBe(true);
  });
});

/**
 * E: dropped out of WSL: every path on it fails ENODEV, as `/mnt/e` did on
 * 2026-10-22, when the Script tab 500'd on this walk.
 */
const withEOffline = Effect.provideServiceEffect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) => ({
    ...fs,
    exists: (path: string) =>
      path.startsWith(rootE)
        ? Effect.fail(
            new SystemError({
              reason: "Unknown",
              module: "FileSystem",
              method: "access",
              pathOrDescriptor: path,
              cause: Object.assign(new Error("ENODEV: no such device"), {
                code: "ENODEV",
              }),
            })
          )
        : fs.exists(path),
  }))
);

describe("an Offline Storage Root", () => {
  it("lists the files on the roots that are there, and fails nothing", async () => {
    writeFixture("on-d.md");
    writeIn(nodePath.join(rootE, "video-files"), "on-e.md");

    const entries = await run(withEOffline(listVideoFiles(LINEAGE)));

    expect(entries.map((e) => e.path)).toEqual(["on-d.md"]);
  });
});

describe("the on-disk store", () => {
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

  describe("copyVideoFilesDirectory", () => {
    const COPY = "lineage-2";

    it("carries a duplicated Video's files into its own directory", async () => {
      writeFixture("notes/snippet.md", "writer context");
      writeFixture("thumbnail-abc.png", "png bytes");

      const copied = await run(copyVideoFilesDirectory(LINEAGE, COPY));

      expect(copied).toBe(2);
      expect(
        (await run(listVideoFiles(COPY))).map((entry) => entry.path)
      ).toEqual(["notes/snippet.md", "thumbnail-abc.png"]);
      expect(await run(readVideoFileString(COPY, "notes/snippet.md"))).toBe(
        "writer context"
      );
    });

    it("leaves the source Video's files where they were", async () => {
      writeFixture("notes/snippet.md", "writer context");

      await run(copyVideoFilesDirectory(LINEAGE, COPY));

      expect(await run(readVideoFileString(LINEAGE, "notes/snippet.md"))).toBe(
        "writer context"
      );
    });

    it("writes nothing when source and target share one lineage", async () => {
      // The Draft Version snapshot path: it copies `lineageId`, so both rows
      // already name the one directory and a copy would be self-overwriting.
      writeFixture("notes/snippet.md");

      expect(await run(copyVideoFilesDirectory(LINEAGE, LINEAGE))).toBe(0);
    });

    it("is a no-op for a Video that has no files at all", async () => {
      expect(await run(copyVideoFilesDirectory("never-created", COPY))).toBe(0);
      expect(nodeFs.existsSync(nodePath.join(baseDir, COPY))).toBe(false);
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
