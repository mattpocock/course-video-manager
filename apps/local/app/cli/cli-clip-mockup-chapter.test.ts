import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
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
// cvm clip-mockup-chapter: the noun, and the order space it shares
//
// Its own file because the per-file token budget will not take it in an
// existing one.
//
// TWO SUITES, and the split is the point. The chapter verbs are NOT
// local-only, so the first suite declares the machine NOT local — the inverse
// of what cli-local-only.test.ts asserts about `clip-mockup`. But
// `clip-mockup add` IS refused in that state, so the shared-order-space proof
// needs the machine declared local, and lives in the second suite with the
// frame directory the frames go in.
//
// Neither suite seeds a Draft Course Version guard, because the noun has none:
// the standalone Video every case writes to belongs to no Course Version at
// all, and every write still lands.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
const speech = fakeSpeech();
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

interface ChapterRow {
  id: string;
  videoId: string;
  name: string;
  order: string;
  archived: boolean;
  createdAt: string;
}

interface MockupRow {
  id: string;
  videoId: string;
  line: string;
  order: string;
}

const chapterOf = (stdout: string): ChapterRow => one<ChapterRow>(stdout);

const failureOf = (result: RunResult) =>
  JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

/**
 * Set explicitly rather than deleted, both ways: the author's own repo .env
 * says `true`, so a deleted key would read as local and hide the very
 * asymmetry the first suite is here to prove.
 */
const declareLocalMachine = (local: boolean) => {
  process.env[LOCAL_MACHINE_ENV_KEY] = local ? "true" : "false";
};

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeClipMockupRun(testDb, speech);
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-cmc-src-"));
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

describe("cvm clip-mockup-chapter: off the local machine", () => {
  beforeEach(() => {
    declareLocalMachine(false);
  });

  /**
   * Clip Mockups are seeded STRAIGHT INTO THE DATABASE here, not through
   * `cvm clip-mockup add`: that verb is local-only and this suite is the one
   * that proves the chapter verbs are not.
   */
  const seedMockups = async (
    videoId: string,
    lines: ReadonlyArray<string>
  ): Promise<MockupRow[]> => {
    const rows: MockupRow[] = [];
    for (const [index, line] of lines.entries()) {
      const [row] = await testDb
        .insert(schema.clipMockups)
        .values({
          videoId,
          line,
          imagePath: `${line}.png`,
          audioPath: `${line}.wav`,
          durationSeconds: 1.5,
          order: `a${index}`,
        })
        .returning();
      rows.push(row as MockupRow);
    }
    return rows;
  };

  const list = async (videoId: string): Promise<ChapterRow[]> =>
    ndjson(
      (await run(["clip-mockup-chapter", "list", "--video", videoId])).stdout
    ) as ChapterRow[];

  const add = async (
    videoId: string,
    title: string,
    anchor: ReadonlyArray<string> = []
  ) =>
    run([
      "clip-mockup-chapter",
      "add",
      "--video",
      videoId,
      "--title",
      title,
      ...anchor,
    ]);

  // -----------------------------------------------------------------------
  // add / list
  // -----------------------------------------------------------------------

  it("add appends a Chapter and echoes the created row", async () => {
    const r = await add(s.standaloneActiveId, "The problem");

    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    const row = chapterOf(r.stdout);
    expect(row.name).toBe("The problem");
    expect(row.videoId).toBe(s.standaloneActiveId);
    expect(row.archived).toBe(false);
  });

  it("list prints the Video's Chapters as NDJSON in order", async () => {
    await add(s.standaloneActiveId, "One");
    await add(s.standaloneActiveId, "Two");
    await add(s.standaloneActiveId, "Three");

    expect((await list(s.standaloneActiveId)).map((c) => c.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("list of a Video with no Chapters prints nothing and exits 0", async () => {
    const r = await run([
      "clip-mockup-chapter",
      "list",
      "--video",
      s.standaloneActiveId,
    ]);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("every verb runs with the machine NOT declared local", async () => {
    // The inverse of cli-local-only.test.ts's assertion about `clip-mockup`:
    // nothing here is refused with exit 7, because a divider is a row.
    const added = await add(s.standaloneActiveId, "Anywhere");
    const listed = await run([
      "clip-mockup-chapter",
      "list",
      "--video",
      s.standaloneActiveId,
    ]);

    expect(added.exitCode).toBe(0);
    expect(listed.exitCode).toBe(0);
    expect(added.stderr).toBe("");
    expect(listed.stderr).toBe("");
  });

  // -----------------------------------------------------------------------
  // anchors, over the merged order space
  // -----------------------------------------------------------------------

  it("--before places a Chapter against a Clip Mockup id", async () => {
    const [, second] = await seedMockups(s.standaloneActiveId, [
      "one",
      "two",
      "three",
    ]);

    const chapter = chapterOf(
      (await add(s.standaloneActiveId, "Middle", ["--before", second!.id]))
        .stdout
    );

    const mockups = await testDb.query.clipMockups.findMany({});
    const byId = new Map(mockups.map((m) => [m.id, m.order]));
    expect(chapter.order > byId.get(mockups[0]!.id)!).toBe(true);
    expect(chapter.order < byId.get(second!.id)!).toBe(true);
  });

  it("--after places a Chapter against another Chapter id", async () => {
    const first = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    const third = chapterOf((await add(s.standaloneActiveId, "Three")).stdout);

    const second = chapterOf(
      (await add(s.standaloneActiveId, "Two", ["--after", first.id])).stdout
    );

    expect(second.order > first.order).toBe(true);
    expect(second.order < third.order).toBe(true);
    expect((await list(s.standaloneActiveId)).map((c) => c.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  // -----------------------------------------------------------------------
  // bad input
  // -----------------------------------------------------------------------

  it("both --before and --after is invalid input", async () => {
    const [first, second] = await seedMockups(s.standaloneActiveId, [
      "one",
      "two",
    ]);

    const r = await add(s.standaloneActiveId, "Nope", [
      "--before",
      first!.id,
      "--after",
      second!.id,
    ]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(r.stdout).toBe("");
  });

  it("an unknown --video is a not-found", async () => {
    const r = await add("no-such-video", "Nope");

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  it("an unknown anchor is a not-found", async () => {
    const r = await add(s.standaloneActiveId, "Nope", [
      "--before",
      "no-such-row",
    ]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });
});

describe("one order space shared with Clip Mockups", () => {
  beforeEach(() => {
    // `clip-mockup add` is local-only, so this suite declares the machine
    // local. The chapter verbs work in both states.
    declareLocalMachine(true);
  });

  const sourceImage = (name: string): string => {
    const full = nodePath.join(sourceDir, name);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const addMockup = async (videoId: string, line: string): Promise<MockupRow> =>
    one<MockupRow>(
      (
        await run([
          "clip-mockup",
          "add",
          "--video",
          videoId,
          "--image",
          sourceImage(`${line}.png`),
          "--say",
          line,
        ])
      ).stdout
    );

  it("a Clip Mockup added after a Chapter lands INSIDE that Chapter", async () => {
    await addMockup(s.standaloneActiveId, "One");
    await addMockup(s.standaloneActiveId, "Two");

    const chapter = chapterOf(
      (
        await run([
          "clip-mockup-chapter",
          "add",
          "--video",
          s.standaloneActiveId,
          "--title",
          "Part two",
        ])
      ).stdout
    );

    const third = await addMockup(s.standaloneActiveId, "Three");

    // The whole proof of one shared order space: the appended Clip Mockup sorts
    // AFTER the divider. Computed against the Clip Mockup table alone it would
    // sort at the same key as the divider, so the row would be outside the
    // Chapter the author had just opened.
    expect(third.order > chapter.order).toBe(true);
  });

  it("bare clip-mockup list is unchanged — append still appends", async () => {
    const one1 = await addMockup(s.standaloneActiveId, "One");
    await run([
      "clip-mockup-chapter",
      "add",
      "--video",
      s.standaloneActiveId,
      "--title",
      "Part two",
    ]);
    const two = await addMockup(s.standaloneActiveId, "Two");

    const rows = ndjson(
      (await run(["clip-mockup", "list", "--video", s.standaloneActiveId]))
        .stdout
    ) as MockupRow[];

    expect(rows.map((r) => r.id)).toEqual([one1.id, two.id]);
  });

  it("clip-mockup move --before a Chapter id lifts the row above the divider", async () => {
    const first = await addMockup(s.standaloneActiveId, "One");
    const chapter = chapterOf(
      (
        await run([
          "clip-mockup-chapter",
          "add",
          "--video",
          s.standaloneActiveId,
          "--title",
          "Part two",
        ])
      ).stdout
    );
    const second = await addMockup(s.standaloneActiveId, "Two");

    const r = await run([
      "clip-mockup",
      "move",
      "--before",
      chapter.id,
      second.id,
    ]);

    expect(r.exitCode).toBe(0);
    const moved = one<MockupRow>(r.stdout);
    expect(moved.order > first.order).toBe(true);
    expect(moved.order < chapter.order).toBe(true);
  });
});
