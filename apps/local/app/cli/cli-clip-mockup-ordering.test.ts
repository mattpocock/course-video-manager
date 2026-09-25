import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
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
import { fakeSpeech, makeClipMockupRun } from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup: move / update / --at position addressing
//
// The second half of the noun, split out of ./cli-clip-mockup-writes.test.ts
// only because the one file outgrew the repo's per-file token budget. Same
// scaffolding, same contract: CLIP_MOCKUP_DIR points at a temp dir and the
// suite declares the machine local, because every clip-mockup verb is
// local-only.
//
// What it is here to prove: reordering touches the ORDER and nothing on disk,
// 'update' changes one of the two fields without disturbing the other, and the
// POSITION an author reads off the screen reaches the same row its uuid does.
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

describe("cvm clip-mockup: ordering and addressing", () => {
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

  /** Write a PNG for the CLI to copy in, returning its path. */
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

  const frameDir = (lineageId: string) => nodePath.join(frames.dir, lineageId);

  const failureOf = (result: RunResult) =>
    JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

  // -----------------------------------------------------------------------
  // move — ordering only
  // -----------------------------------------------------------------------

  const ids = async (videoId: string) => (await list(videoId)).map((m) => m.id);

  it("move --before reorders the Animatic and re-lists in the new order", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");
    const c = await add(s.standaloneActiveId, "Three");

    const r = await run(["clip-mockup", "move", "--before", a.id, c.id]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(obj(r.stdout).id).toBe(c.id);

    expect(await ids(s.standaloneActiveId)).toEqual([c.id, a.id, b.id]);
  });

  it("move --after reorders the Animatic", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");
    const c = await add(s.standaloneActiveId, "Three");

    await run(["clip-mockup", "move", "--after", b.id, a.id]);
    expect(await ids(s.standaloneActiveId)).toEqual([b.id, a.id, c.id]);
  });

  it("move with no anchor sends it to the end", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");
    const c = await add(s.standaloneActiveId, "Three");

    await run(["clip-mockup", "move", a.id]);
    expect(await ids(s.standaloneActiveId)).toEqual([b.id, c.id, a.id]);
  });

  it("move changes only the order — no file on disk is read or written", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");
    const dir = frameDir(s.standaloneActiveLineageId);
    const before = nodeFs.readdirSync(dir).sort();

    const moved = obj(
      (await run(["clip-mockup", "move", "--before", a.id, b.id])).stdout
    );

    expect(nodeFs.readdirSync(dir).sort()).toEqual(before);
    expect(moved.imagePath).toBe(b.imagePath);
    expect(moved.line).toBe(b.line);
    expect(moved.audioPath).toBe(b.audioPath);
    expect(moved.durationSeconds).toBe(b.durationSeconds);
    expect(moved.order).not.toBe(b.order);
  });

  it("move with both --before and --after is invalid input, exit 3", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");

    const r = await run([
      "clip-mockup",
      "move",
      "--before",
      a.id,
      "--after",
      a.id,
      b.id,
    ]);
    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(await ids(s.standaloneActiveId)).toEqual([a.id, b.id]);
  });

  it("move against an unknown anchor is a not-found, exit 2", async () => {
    const a = await add(s.standaloneActiveId, "One");

    const r = await run(["clip-mockup", "move", "--before", "nope", a.id]);
    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  it("update --image copies the new PNG in and leaves the line and its speech alone", async () => {
    const created = await add(
      s.standaloneActiveId,
      "The line stays.",
      "v1.png",
      "FRAME-V1"
    );

    const r = await run([
      "clip-mockup",
      "update",
      "--image",
      sourceImage("v2.png", "FRAME-V2"),
      created.id,
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");

    const row = obj(r.stdout);
    expect(row.id).toBe(created.id);
    expect(row.line).toBe("The line stays.");
    // The words did not change, so neither did their voicing or its length.
    expect(row.audioPath).toBe(created.audioPath);
    expect(row.durationSeconds).toBe(created.durationSeconds);
    expect(row.order).toBe(created.order);
    expect(row.imagePath).not.toBe(created.imagePath);

    const dir = frameDir(s.standaloneActiveLineageId);
    expect(nodeFs.readFileSync(nodePath.join(dir, row.imagePath), "utf8")).toBe(
      "FRAME-V2"
    );
    // The old frame is left where it was — the row is the state.
    expect(nodeFs.existsSync(nodePath.join(dir, created.imagePath))).toBe(true);
  });

  it("update --say changes the line and leaves the frame alone", async () => {
    const created = await add(s.standaloneActiveId, "Too dense.");

    const row = obj(
      (
        await run([
          "clip-mockup",
          "update",
          "--say",
          "Shorter, and it lands harder.",
          created.id,
        ])
      ).stdout
    );

    expect(row.line).toBe("Shorter, and it lands harder.");
    expect(row.imagePath).toBe(created.imagePath);
    // New words are new speech; what the picture is has not changed.
    expect(row.audioPath).not.toBe(created.audioPath);
    expect(
      nodeFs.readdirSync(frameDir(s.standaloneActiveLineageId)).sort()
    ).toEqual(
      [created.imagePath, created.audioPath, row.audioPath].sort() as string[]
    );
  });

  it("update takes both --image and --say at once", async () => {
    const created = await add(s.standaloneActiveId, "Old.");

    const row = obj(
      (
        await run([
          "clip-mockup",
          "update",
          "--image",
          sourceImage("both.png", "BOTH"),
          "--say",
          "New.",
          created.id,
        ])
      ).stdout
    );

    expect(row.line).toBe("New.");
    expect(row.imagePath).not.toBe(created.imagePath);
  });

  it("update with neither --image nor --say is invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId, "One");

    const r = await run(["clip-mockup", "update", created.id]);
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    expect(failureOf(r)._tag).toBe("ParseError");
  });

  it("update with an empty --say is invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId, "One");

    const r = await run(["clip-mockup", "update", "--say", "   ", created.id]);
    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect((await list(s.standaloneActiveId))[0]!.line).toBe("One");
  });

  it("update with an unreadable source image is invalid input and changes nothing", async () => {
    const created = await add(s.standaloneActiveId, "One");

    const r = await run([
      "clip-mockup",
      "update",
      "--image",
      nodePath.join(sourceDir, "missing.png"),
      "--say",
      "Should not land.",
      created.id,
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    const row = (await list(s.standaloneActiveId))[0]!;
    expect(row.line).toBe("One");
    expect(row.imagePath).toBe(created.imagePath);
  });

  it("update of an unknown or deleted id is a not-found, exit 2", async () => {
    const created = await add(s.standaloneActiveId, "One");
    await run(["clip-mockup", "delete", created.id]);

    for (const id of ["nope", created.id]) {
      const r = await run(["clip-mockup", "update", "--say", "New.", id]);
      expect(r.exitCode, id).toBe(2);
      expect(failureOf(r)._tag, id).toBe("NotFoundError");
    }
  });

  // -----------------------------------------------------------------------
  // --at: the position the author reads off the screen
  // -----------------------------------------------------------------------

  describe("position addressing", () => {
    const seedThree = async () => ({
      first: await add(s.standaloneActiveId, "One"),
      second: await add(s.standaloneActiveId, "Two"),
      third: await add(s.standaloneActiveId, "Three"),
    });

    it("counts from 1, in the order list prints", async () => {
      const { first, second, third } = await seedThree();

      for (const [at, expected] of [
        [1, first.id],
        [2, second.id],
        [3, third.id],
      ] as const) {
        const r = await run([
          "clip-mockup",
          "update",
          "--video",
          s.standaloneActiveId,
          "--at",
          String(at),
          "--say",
          `Line ${at}.`,
        ]);
        expect(r.exitCode, `--at ${at}`).toBe(0);
        expect(obj(r.stdout).id, `--at ${at}`).toBe(expected);
      }
    });

    it("reaches the same row as the bare id does", async () => {
      const { second } = await seedThree();

      const byId = obj(
        (await run(["clip-mockup", "update", "--say", "A.", second.id])).stdout
      );
      const byPosition = obj(
        (
          await run([
            "clip-mockup",
            "update",
            "--video",
            s.standaloneActiveId,
            "--at",
            "2",
            "--say",
            "B.",
          ])
        ).stdout
      );

      expect(byPosition.id).toBe(byId.id);
      expect(byPosition.id).toBe(second.id);
    });

    it("follows a move: positions are whatever list now shows", async () => {
      const { first, second, third } = await seedThree();

      await run([
        "clip-mockup",
        "move",
        "--video",
        s.standaloneActiveId,
        "--at",
        "3",
        "--before",
        first.id,
      ]);
      expect(await ids(s.standaloneActiveId)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);

      const r = await run([
        "clip-mockup",
        "delete",
        "--video",
        s.standaloneActiveId,
        "--at",
        "1",
      ]);
      expect(r.exitCode).toBe(0);
      expect(obj(r.stdout)).toMatchObject({ id: third.id, archived: true });
      expect(await ids(s.standaloneActiveId)).toEqual([first.id, second.id]);
    });

    it("works on every write verb", async () => {
      const { first } = await seedThree();

      const updated = obj(
        (
          await run([
            "clip-mockup",
            "update",
            "--video",
            s.standaloneActiveId,
            "--at",
            "1",
            "--image",
            sourceImage("at-image.png", "AT-IMAGE"),
          ])
        ).stdout
      );
      expect(updated.id).toBe(first.id);
      expect(updated.imagePath).not.toBe(first.imagePath);
      expect(
        nodeFs.readFileSync(
          nodePath.join(
            frameDir(s.standaloneActiveLineageId),
            updated.imagePath
          ),
          "utf8"
        )
      ).toBe("AT-IMAGE");
    });

    it("a position outside the list is invalid input, naming the length", async () => {
      await seedThree();

      for (const at of ["4", "0", "-1"]) {
        const r = await run([
          "clip-mockup",
          "delete",
          "--video",
          s.standaloneActiveId,
          "--at",
          at,
        ]);
        expect(r.exitCode, at).toBe(3);
        expect(r.stdout, at).toBe("");
        const failure = failureOf(r);
        expect(failure._tag, at).toBe("ParseError");
        expect(failure.message, at).toContain("3 Clip Mockups");
      }
      expect(await ids(s.standaloneActiveId)).toHaveLength(3);
    });

    it("a position against an empty Animatic is invalid input, naming zero", async () => {
      const r = await run([
        "clip-mockup",
        "delete",
        "--video",
        s.standaloneActiveId,
        "--at",
        "1",
      ]);
      expect(r.exitCode).toBe(3);
      expect(failureOf(r).message).toContain("0 Clip Mockups");
    });

    it("a position and a bare id together is invalid input, exit 3", async () => {
      const { first } = await seedThree();

      const r = await run([
        "clip-mockup",
        "delete",
        "--video",
        s.standaloneActiveId,
        "--at",
        "1",
        first.id,
      ]);
      expect(r.exitCode).toBe(3);
      expect(r.stdout).toBe("");
      expect(failureOf(r)._tag).toBe("ParseError");
      expect(await ids(s.standaloneActiveId)).toHaveLength(3);
    });

    it("--video beside a bare id is invalid input, exit 3", async () => {
      const { first } = await seedThree();

      const r = await run([
        "clip-mockup",
        "delete",
        "--video",
        s.standaloneActiveId,
        first.id,
      ]);
      expect(r.exitCode).toBe(3);
      expect(failureOf(r)._tag).toBe("ParseError");
    });

    it("--at without --video is invalid input, exit 3", async () => {
      await seedThree();

      const r = await run(["clip-mockup", "delete", "--at", "1"]);
      expect(r.exitCode).toBe(3);
      expect(failureOf(r)._tag).toBe("ParseError");
      expect(await ids(s.standaloneActiveId)).toHaveLength(3);
    });

    it("neither a position nor an id is invalid input, exit 3", async () => {
      const r = await run(["clip-mockup", "delete"]);
      expect(r.exitCode).toBe(3);
      expect(failureOf(r)._tag).toBe("ParseError");
    });

    it("a non-numeric position is invalid input, exit 3", async () => {
      await seedThree();

      const r = await run([
        "clip-mockup",
        "delete",
        "--video",
        s.standaloneActiveId,
        "--at",
        "fourteen",
      ]);
      expect(r.exitCode).toBe(3);
      expect(await ids(s.standaloneActiveId)).toHaveLength(3);
    });

    it("an unknown or archived --video is a not-found, exit 2", async () => {
      for (const videoId of ["nope", s.standaloneArchivedId]) {
        const r = await run([
          "clip-mockup",
          "delete",
          "--video",
          videoId,
          "--at",
          "1",
        ]);
        expect(r.exitCode, videoId).toBe(2);
        expect(failureOf(r)._tag, videoId).toBe("NotFoundError");
      }
    });
  });
});
