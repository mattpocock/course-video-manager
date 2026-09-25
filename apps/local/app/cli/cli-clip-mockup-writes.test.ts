import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  makeTempClipMockupDir,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import {
  fakeSpeech,
  makeClipMockupRun,
  FAKE_DURATION_SECONDS,
} from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup: add / list / get / delete
//
// A Clip Mockup is half a row and half a file: the line and the order are in
// the database, the frame is a PNG under {CLIP_MOCKUP_DIR}/{lineageId}/. So
// this suite points CLIP_MOCKUP_DIR at a temp dir (buildProgram provides the
// real FileSystem) and asserts BOTH halves — what the CLI printed, and what
// actually landed on disk.
//
// 'add' also SPEAKS its line, so the speech service is faked (see
// ./cli-clip-mockup-test-harness.ts) and no Gemini call ever runs. What the
// speech itself is asserted to do lives in ./cli-clip-mockup-speech.test.ts.
//
// Touching the disk is what makes every verb LOCAL-ONLY, so the suite declares
// the machine local the way the author's .env does. The refusals themselves
// live in ./cli-local-only.test.ts.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
const speech = fakeSpeech();
let sourceDir: string;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeClipMockupRun(testDb, speech);
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-frame-src-"));
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  frames.cleanup();
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(frames.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(frames.dir, { recursive: true });
  speech.spoken.length = 0;
});

describe("cvm clip-mockup", () => {
  interface Mockup {
    id: string;
    videoId: string;
    line: string;
    imagePath: string;
    audioPath: string | null;
    durationSeconds: number | null;
    order: string;
    archived: boolean;
    createdAt: string;
  }

  const obj = (stdout: string): Mockup => one<Mockup>(stdout);

  /** Write a PNG for `clip-mockup add` to copy in, returning its path. */
  const sourceImage = (name: string, contents = "PNG-BYTES"): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, contents);
    return full;
  };

  const add = async (
    videoId: string,
    line: string,
    imageName = `${line.replace(/\W+/g, "-")}.png`,
    contents?: string
  ): Promise<Mockup> =>
    obj(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          videoId,
          "--image",
          sourceImage(imageName, contents),
          "--say",
          line,
        ])
      ).stdout
    );

  const list = async (videoId: string): Promise<Mockup[]> =>
    ndjson(
      (await run(["clip-mockup", "list", "--video", videoId])).stdout
    ) as Mockup[];

  const freshVideo = async (
    title: string,
    format: string
  ): Promise<{ id: string; lineageId: string }> => {
    const [v] = await testDb
      .insert(schema.videos)
      .values({ title, originalFootagePath: "f.mp4", format })
      .returning();
    return { id: v!.id, lineageId: v!.lineageId };
  };

  const frameDir = (lineageId: string) => nodePath.join(frames.dir, lineageId);

  const failureOf = (result: RunResult) =>
    JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

  // -----------------------------------------------------------------------
  // add
  // -----------------------------------------------------------------------

  it("add copies the PNG in, creates the row at the end, and echoes it", async () => {
    const { stdout, stderr, exitCode } = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--image",
      sourceImage("first.png", "FIRST-FRAME"),
      "--say",
      "Here's the problem.",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // Pretty single object, not NDJSON.
    expect(stdout).toMatch(/^\{\n/);

    const row = obj(stdout);
    expect(row.videoId).toBe(s.standaloneActiveId);
    expect(row.line).toBe("Here's the problem.");
    expect(row.archived).toBe(false);
    // The line was spoken as it was added, so the row already knows how long
    // this moment of the Animatic runs.
    expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);

    const dir = frameDir(s.standaloneActiveLineageId);
    // The frame and its speech, side by side in the Video's own directory.
    expect(nodeFs.readdirSync(dir).sort()).toEqual(
      [row.imagePath, row.audioPath].sort()
    );
    expect(nodeFs.readFileSync(nodePath.join(dir, row.imagePath), "utf8")).toBe(
      "FIRST-FRAME"
    );
  });

  it("add stores a path RELATIVE to the Clip Mockup directory, not the caller's", async () => {
    const source = sourceImage("scratch-frame.png");
    const row = obj(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          s.standaloneActiveId,
          "--image",
          source,
          "--say",
          "One line.",
        ])
      ).stdout
    );

    expect(nodePath.isAbsolute(row.imagePath)).toBe(false);
    expect(row.imagePath).not.toContain(sourceDir);
    expect(row.imagePath).not.toContain(frames.dir);
    // The CVM keeps its OWN copy: clearing the scratch folder cannot empty it.
    nodeFs.rmSync(source);
    expect(
      nodeFs.existsSync(
        nodePath.join(frameDir(s.standaloneActiveLineageId), row.imagePath)
      )
    ).toBe(true);
  });

  it("add appends to the end of the Video's Animatic, in order", async () => {
    const first = await add(s.standaloneActiveId, "One");
    const second = await add(s.standaloneActiveId, "Two");
    const third = await add(s.standaloneActiveId, "Three");

    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it("add keeps two frames apart even when the sources share a basename", async () => {
    const a = await add(s.standaloneActiveId, "One", "frame.png", "FRAME-A");
    const b = await add(s.standaloneActiveId, "Two", "frame.png", "FRAME-B");

    expect(a.imagePath).not.toBe(b.imagePath);
    const dir = frameDir(s.standaloneActiveLineageId);
    expect(nodeFs.readFileSync(nodePath.join(dir, a.imagePath), "utf8")).toBe(
      "FRAME-A"
    );
    expect(nodeFs.readFileSync(nodePath.join(dir, b.imagePath), "utf8")).toBe(
      "FRAME-B"
    );
  });

  it("add without --say is invalid input, exit 3, and writes nothing", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--image",
      sourceImage("no-line.png"),
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(nodeFs.existsSync(frameDir(s.standaloneActiveLineageId))).toBe(
      false
    );
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add without --image is invalid input, exit 3", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--say",
      "A moment with no picture.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add with an unreadable source image is invalid input, exit 3", async () => {
    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--image",
      nodePath.join(sourceDir, "does-not-exist.png"),
      "--say",
      "A line.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(await list(s.standaloneActiveId)).toEqual([]);
  });

  it("add on a Short is refused, naming Landscape", async () => {
    const short = await freshVideo("short.mp4", "short");

    const r = await run([
      "clip-mockup",
      "add",
      "--video",
      short.id,
      "--image",
      sourceImage("short-frame.png"),
      "--say",
      "Not allowed.",
    ]);

    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("ParseError");
    expect(failure.message).toContain("Landscape only");
    expect(nodeFs.existsSync(frameDir(short.lineageId))).toBe(false);
  });

  it("add on an unknown or archived Video is a not-found, exit 2", async () => {
    for (const videoId of ["nope", s.standaloneArchivedId]) {
      const r = await run([
        "clip-mockup",
        "add",
        "--video",
        videoId,
        "--image",
        sourceImage("orphan.png"),
        "--say",
        "A line.",
      ]);
      expect(r.exitCode, videoId).toBe(2);
      expect(failureOf(r)._tag, videoId).toBe("NotFoundError");
    }
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  it("list emits NDJSON in order", async () => {
    await add(s.lessonVideoId, "One");
    await add(s.lessonVideoId, "Two");

    const r = await run(["clip-mockup", "list", "--video", s.lessonVideoId]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(2);
    expect((ndjson(r.stdout) as Mockup[]).map((m) => m.line)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("list of a Video with no Clip Mockups prints nothing and exits 0", async () => {
    const r = await run([
      "clip-mockup",
      "list",
      "--video",
      s.standaloneActiveId,
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("list does not leak another Video's Clip Mockups", async () => {
    await add(s.standaloneActiveId, "Mine");
    await add(s.lessonVideoId, "Theirs");

    expect((await list(s.standaloneActiveId)).map((m) => m.line)).toEqual([
      "Mine",
    ]);
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------

  it("get of one id echoes one pretty object", async () => {
    const created = await add(s.standaloneActiveId, "One");

    const r = await run(["clip-mockup", "get", created.id]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/^\{\n/);
    expect(obj(r.stdout).id).toBe(created.id);
  });

  it("get is variadic: several ids emit NDJSON", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");

    const r = await run(["clip-mockup", "get", a.id, b.id]);
    expect(r.exitCode).toBe(0);
    expect((ndjson(r.stdout) as Mockup[]).map((m) => m.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("get of an unknown id is a not-found, exit 2", async () => {
    const r = await run(["clip-mockup", "get", "nope"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  it("get of several ids keeps stdout pure when one is missing", async () => {
    const a = await add(s.standaloneActiveId, "One");

    const r = await run(["clip-mockup", "get", a.id, "nope"]);
    expect(r.exitCode).toBe(2);
    expect((ndjson(r.stdout) as Mockup[]).map((m) => m.id)).toEqual([a.id]);
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  it("delete archives the row, echoes archived:true, and hides it from list", async () => {
    const first = await add(s.standaloneActiveId, "One");
    const second = await add(s.standaloneActiveId, "Two");

    const r = await run(["clip-mockup", "delete", first.id]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(obj(r.stdout)).toMatchObject({ id: first.id, archived: true });

    expect((await list(s.standaloneActiveId)).map((m) => m.id)).toEqual([
      second.id,
    ]);
  });

  it("delete leaves the frame on disk — the row is the state", async () => {
    const created = await add(s.standaloneActiveId, "One");
    await run(["clip-mockup", "delete", created.id]);

    expect(
      nodeFs.existsSync(
        nodePath.join(frameDir(s.standaloneActiveLineageId), created.imagePath)
      )
    ).toBe(true);
  });

  it("delete of an unknown id is a not-found, exit 2", async () => {
    const r = await run(["clip-mockup", "delete", "nope"]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  it("any verb on an already-deleted Clip Mockup is a not-found, exit 2", async () => {
    const created = await add(s.standaloneActiveId, "One");
    await run(["clip-mockup", "delete", created.id]);

    for (const argv of [
      ["clip-mockup", "get", created.id],
      ["clip-mockup", "delete", created.id],
    ]) {
      const r = await run(argv);
      expect(r.exitCode, argv.join(" ")).toBe(2);
      expect(failureOf(r)._tag, argv.join(" ")).toBe("NotFoundError");
    }
  });
});
