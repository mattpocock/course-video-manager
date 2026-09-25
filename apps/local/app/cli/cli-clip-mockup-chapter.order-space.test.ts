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
import {
  FAKE_DURATION_SECONDS,
  fakeSpeech,
  makeClipMockupRun,
} from "./cli-clip-mockup-test-harness";

// ===========================================================================
// The ONE order space a Video's Chapters and Clip Mockups share, and the
// `clip-mockup list --with-chapters` stream that reads it back.
//
// Its own file, a sibling of cli-clip-mockup-chapter.test.ts, because the two
// together are over the per-file token budget. The seam is the one that file
// already declared between its two suites, so nothing moved across it: the
// chapter verbs stay there, every case that needs `clip-mockup add` or
// `clip-mockup list` is here.
//
// `clip-mockup add` IS local-only, so this file declares the machine LOCAL —
// the inverse of the sibling, which proves the chapter verbs are not — and
// owns the frame directory the frames go in.
//
// No Draft Course Version guard is seeded, because the noun has none: the
// standalone Video every case writes to belongs to no Course Version at all,
// and every write still lands.
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

/**
 * Set explicitly rather than deleted: the author's own repo .env says `true`,
 * so the sibling file's first suite cannot rely on a deleted key, and this one
 * restores whatever was there when it is done.
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

  it("delete absorbs its Clip Mockups upward — every one survives", async () => {
    // The acceptance criterion, asserted as an OUTCOME rather than as the rule.
    // `clip-mockup list` is local-only, so this case lives in the local suite.
    const above = await addMockup(s.standaloneActiveId, "Above");
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
    const under = await addMockup(s.standaloneActiveId, "Under");
    const alsoUnder = await addMockup(s.standaloneActiveId, "AlsoUnder");

    const deleted = await run(["clip-mockup-chapter", "delete", chapter.id]);
    expect(deleted.exitCode).toBe(0);

    const rows = ndjson(
      (await run(["clip-mockup", "list", "--video", s.standaloneActiveId]))
        .stdout
    ) as MockupRow[];

    // Not one frame or line is lost, and none is re-ordered: the two Clip
    // Mockups that were under the divider are simply unchaptered now.
    expect(rows.map((r) => r.id)).toEqual([above.id, under.id, alsoUnder.id]);
    expect(rows.map((r) => r.order)).toEqual([
      above.order,
      under.order,
      alsoUnder.order,
    ]);
  });

  // =========================================================================
  // cvm clip-mockup list --with-chapters
  // =========================================================================

  describe("clip-mockup list --with-chapters", () => {
    interface AnimaticRow {
      type: "clipMockup" | "clipMockupChapter";
      position: number | null;
      id: string;
      line?: string;
      name?: string;
      durationSeconds?: number;
    }

    const addChapter = async (
      videoId: string,
      title: string
    ): Promise<ChapterRow> =>
      chapterOf(
        (
          await run([
            "clip-mockup-chapter",
            "add",
            "--video",
            videoId,
            "--title",
            title,
          ])
        ).stdout
      );

    const list = async (
      videoId: string,
      withChapters: boolean
    ): Promise<RunResult> =>
      run([
        "clip-mockup",
        "list",
        "--video",
        videoId,
        ...(withChapters ? ["--with-chapters"] : []),
      ]);

    /** One Chapter, then two Clip Mockups, then a Chapter and one more. */
    const seedAnimatic = async () => {
      const opening = await addChapter(s.standaloneActiveId, "The problem");
      const one1 = await addMockup(s.standaloneActiveId, "One");
      const two = await addMockup(s.standaloneActiveId, "Two");
      const part = await addChapter(s.standaloneActiveId, "The fix");
      const three = await addMockup(s.standaloneActiveId, "Three");
      return { opening, one1, two, part, three };
    };

    it("interleaves Chapter rows in order, with type on every row", async () => {
      const a = await seedAnimatic();

      const r = await list(s.standaloneActiveId, true);

      expect(r.exitCode).toBe(0);
      expect(r.stderr).toBe("");
      const rows = ndjson(r.stdout) as AnimaticRow[];
      expect(rows.map((row) => row.id)).toEqual([
        a.opening.id,
        a.one1.id,
        a.two.id,
        a.part.id,
        a.three.id,
      ]);
      expect(rows.map((row) => row.type)).toEqual([
        "clipMockupChapter",
        "clipMockup",
        "clipMockup",
        "clipMockupChapter",
        "clipMockup",
      ]);
    });

    it("counts position over Clip Mockups only, and null on a Chapter", async () => {
      await seedAnimatic();

      const rows = ndjson(
        (await list(s.standaloneActiveId, true)).stdout
      ) as AnimaticRow[];

      // The point of the ticket: line 5 of the stream is Clip Mockup 3, so
      // `--at 3` is the number, not the line count 5.
      expect(rows.map((row) => row.position)).toEqual([null, 1, 2, null, 3]);
      expect(rows.at(-1)!.line).toBe("Three");
      expect(rows.at(-1)!.position).toBe(3);
    });

    it("an Animatic with no Chapters prints the same rows either way", async () => {
      await addMockup(s.standaloneActiveId, "One");
      await addMockup(s.standaloneActiveId, "Two");

      const bare = ndjson(
        (await list(s.standaloneActiveId, false)).stdout
      ) as AnimaticRow[];
      const withChapters = ndjson(
        (await list(s.standaloneActiveId, true)).stdout
      ) as AnimaticRow[];

      expect(
        withChapters.map(({ type, position, ...rest }) => {
          expect(type).toBe("clipMockup");
          expect(position).not.toBeNull();
          return rest;
        })
      ).toEqual(bare);
    });

    it("the bare stream is unchanged — no new field and no new row", async () => {
      // The regression the flag exists to avoid. Asserted against the exact
      // key set, because a reader of the bare stream sees only these.
      await seedAnimatic();

      const r = await list(s.standaloneActiveId, false);
      const lines = r.stdout.trimEnd().split("\n");

      expect(lines.length).toBe(3);
      for (const line of lines) {
        expect(Object.keys(JSON.parse(line) as object)).toEqual([
          "id",
          "videoId",
          "line",
          "imagePath",
          "audioPath",
          "durationSeconds",
          "order",
          "archived",
          "createdAt",
        ]);
      }
    });

    it("the bare stream still totals a Video's run time", async () => {
      // `jq -s 'map(.durationSeconds) | add'`, the sum the animatic skill uses
      // for a Video's run time. It reads .durationSeconds off EVERY line, so a
      // single interleaved Chapter row would break it.
      await seedAnimatic();

      const rows = ndjson(
        (await list(s.standaloneActiveId, false)).stdout
      ) as AnimaticRow[];
      const runTime = rows
        .map((row) => row.durationSeconds)
        .reduce((total, seconds) => total! + seconds!, 0);

      expect(rows.every((row) => typeof row.durationSeconds === "number")).toBe(
        true
      );
      expect(runTime).toBe(3 * FAKE_DURATION_SECONDS);
    });
  });
});
