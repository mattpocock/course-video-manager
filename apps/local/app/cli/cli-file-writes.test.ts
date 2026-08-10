import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  makeTempVideoFilesDir,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm file: list / add / get / delete
//
// These verbs touch the DISK rather than the database, so the suite points
// VIDEO_FILES_DIR at a temp dir (buildProgram provides the real FileSystem —
// without it these tests would write into the repo's own ./video-files).
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let videoFiles: ReturnType<typeof makeTempVideoFilesDir>;
let sourceDir: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
  videoFiles = makeTempVideoFilesDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-file-src-"));
});

afterAll(() => {
  videoFiles.cleanup();
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(videoFiles.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(videoFiles.dir, { recursive: true });
});

interface Entry {
  path: string;
  size: number;
  defaultEnabled: boolean;
}

/** Write a local file for `cvm file add` to copy in, returning its path. */
const source = (name: string, contents: string): string => {
  const full = nodePath.join(sourceDir, name);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, contents);
  return full;
};

/** Read a file straight off disk, bypassing the CLI. */
const onDisk = (lineageId: string, relativePath: string): string =>
  nodeFs.readFileSync(
    nodePath.join(videoFiles.dir, lineageId, relativePath),
    "utf8"
  );

describe("file list", () => {
  it("prints nothing (exit 0) when the video has no files", async () => {
    const r = await run(["file", "list", "--video", s.standaloneActiveId]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("lists nested files as NDJSON, sorted by relative path", async () => {
    await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      source("top.md", "a"),
    ]);
    await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "notes/snippet.md",
      source("scratch.md", "bb"),
    ]);

    const r = await run(["file", "list", "--video", s.standaloneActiveId]);

    expect(r.exitCode).toBe(0);
    expect(ndjson(r.stdout)).toEqual([
      { path: "notes/snippet.md", size: 2, defaultEnabled: true },
      { path: "top.md", size: 1, defaultEnabled: true },
    ]);
  });

  it("works the same for a lesson-connected video", async () => {
    await run([
      "file",
      "add",
      "--video",
      s.lessonVideoId,
      source("lesson-note.md", "x"),
    ]);

    const r = await run(["file", "list", "--video", s.lessonVideoId]);

    expect(ndjson(r.stdout)).toEqual([
      { path: "lesson-note.md", size: 1, defaultEnabled: true },
    ]);
  });

  it("is a not-found (exit 2) for an unknown or archived video", async () => {
    expect((await run(["file", "list", "--video", "nope"])).exitCode).toBe(2);
    expect(
      (await run(["file", "list", "--video", s.standaloneArchivedId])).exitCode
    ).toBe(2);
  });
});

describe("file add", () => {
  it("copies a single file in and echoes one object", async () => {
    const r = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      source("notes.md", "hello"),
    ]);

    expect(r.exitCode).toBe(0);
    expect(one<Entry>(r.stdout)).toEqual({
      path: "notes.md",
      size: 5,
      defaultEnabled: true,
    });
    expect(onDisk(s.standaloneActiveLineageId, "notes.md")).toBe("hello");
  });

  it("copies several files and echoes NDJSON", async () => {
    const r = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      source("a.ts", "1"),
      source("b.png", "22"),
    ]);

    expect(r.exitCode).toBe(0);
    expect(ndjson(r.stdout)).toEqual([
      { path: "a.ts", size: 1, defaultEnabled: true },
      { path: "b.png", size: 2, defaultEnabled: false },
    ]);
  });

  it("renames with --as, creating parent directories", async () => {
    const r = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "notes/deep/snippet.md",
      source("scratch.md", "body"),
    ]);

    expect(r.exitCode).toBe(0);
    expect(one<Entry>(r.stdout).path).toBe("notes/deep/snippet.md");
    expect(onDisk(s.standaloneActiveLineageId, "notes/deep/snippet.md")).toBe(
      "body"
    );
  });

  it("rejects --as with several sources (exit 3)", async () => {
    const r = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "one.md",
      source("a.md", "1"),
      source("b.md", "2"),
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
  });

  it("refuses to clobber an existing file unless --force", async () => {
    const first = source("notes.md", "original");
    await run(["file", "add", "--video", s.standaloneActiveId, first]);

    const clash = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      source("notes.md", "replacement"),
    ]);
    expect(clash.exitCode).toBe(3);
    expect(onDisk(s.standaloneActiveLineageId, "notes.md")).toBe("original");

    const forced = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--force",
      source("notes.md", "replacement"),
    ]);
    expect(forced.exitCode).toBe(0);
    expect(onDisk(s.standaloneActiveLineageId, "notes.md")).toBe("replacement");
  });

  it("is invalid input (exit 3) for a missing source or an escaping target", async () => {
    const missing = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      nodePath.join(sourceDir, "does-not-exist.md"),
    ]);
    expect(missing.exitCode).toBe(3);

    const escaping = await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "../escaped.md",
      source("ok.md", "x"),
    ]);
    expect(escaping.exitCode).toBe(3);
    expect(nodeFs.existsSync(nodePath.join(videoFiles.dir, "escaped.md"))).toBe(
      false
    );
  });
});

describe("file get", () => {
  it("returns a file's contents", async () => {
    await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "notes/snippet.md",
      source("scratch.md", "the body"),
    ]);

    const r = await run([
      "file",
      "get",
      "--video",
      s.standaloneActiveId,
      "notes/snippet.md",
    ]);

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toEqual({
      videoId: s.standaloneActiveId,
      path: "notes/snippet.md",
      size: 8,
      defaultEnabled: true,
      content: "the body",
    });
  });

  it("is a not-found (exit 2) for an unknown path", async () => {
    const r = await run([
      "file",
      "get",
      "--video",
      s.standaloneActiveId,
      "nope.md",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
  });
});

describe("file delete", () => {
  it("really unlinks the file", async () => {
    await run([
      "file",
      "add",
      "--video",
      s.standaloneActiveId,
      "--as",
      "notes/snippet.md",
      source("scratch.md", "x"),
    ]);

    const r = await run([
      "file",
      "delete",
      "--video",
      s.standaloneActiveId,
      "notes/snippet.md",
    ]);

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toEqual({
      videoId: s.standaloneActiveId,
      path: "notes/snippet.md",
      deleted: true,
    });
    expect(
      (await run(["file", "list", "--video", s.standaloneActiveId])).stdout
    ).toBe("");
  });

  it("is a not-found (exit 2) for an unknown path", async () => {
    const r = await run([
      "file",
      "delete",
      "--video",
      s.standaloneActiveId,
      "nope.md",
    ]);
    expect(r.exitCode).toBe(2);
  });
});
