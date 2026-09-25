import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import { fakeSpeech, makeClipMockupRun } from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup-chapter: the noun, and its verbs.
//
// Its own file because the per-file token budget will not take it in an
// existing one.
//
// The chapter verbs are NOT local-only, so this suite declares the machine NOT
// local — the inverse of what cli-local-only.test.ts asserts about
// `clip-mockup`. But `clip-mockup add` IS refused in that state, so every case
// that needs it — the order space the noun shares with Clip Mockups, and the
// `clip-mockup list --with-chapters` stream over it — lives in the sibling
// cli-clip-mockup-chapter.order-space.test.ts, which declares the machine
// local and owns the frame directory. The two files are siblings rather than
// one because together they are over the token budget.
//
// No Draft Course Version guard is seeded, because the noun has none: the
// standalone Video every case writes to belongs to no Course Version at all,
// and every write still lands.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
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
 * asymmetry this suite is here to prove.
 */
const declareLocalMachine = (local: boolean) => {
  process.env[LOCAL_MACHINE_ENV_KEY] = local ? "true" : "false";
};

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeClipMockupRun(testDb, speech);
});

afterAll(() => {
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
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

  // -----------------------------------------------------------------------
  // get / update
  // -----------------------------------------------------------------------

  it("get of one id prints one pretty object", async () => {
    const created = chapterOf((await add(s.standaloneActiveId, "One")).stdout);

    const r = await run(["clip-mockup-chapter", "get", created.id]);

    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(chapterOf(r.stdout).id).toBe(created.id);
  });

  it("get of many ids prints NDJSON and names the missing ones on stderr", async () => {
    const one1 = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    const two = chapterOf((await add(s.standaloneActiveId, "Two")).stdout);

    const r = await run([
      "clip-mockup-chapter",
      "get",
      one1.id,
      "no-such-chapter",
      two.id,
    ]);

    expect((ndjson(r.stdout) as ChapterRow[]).map((c) => c.id)).toEqual([
      one1.id,
      two.id,
    ]);
    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
    expect(r.stderr).toContain("no-such-chapter");
  });

  it("get of an unknown id is a not-found", async () => {
    const r = await run(["clip-mockup-chapter", "get", "no-such-chapter"]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
    expect(r.stdout).toBe("");
  });

  it("update renames a Chapter and echoes the row", async () => {
    const created = chapterOf((await add(s.standaloneActiveId, "Old")).stdout);

    // @effect/cli wants the options BEFORE the positional id.
    const r = await run([
      "clip-mockup-chapter",
      "update",
      "--title",
      "New",
      created.id,
    ]);

    expect(r.exitCode).toBe(0);
    const row = chapterOf(r.stdout);
    expect(row.id).toBe(created.id);
    expect(row.name).toBe("New");
    expect(row.order).toBe(created.order);
    expect((await list(s.standaloneActiveId)).map((c) => c.name)).toEqual([
      "New",
    ]);
  });

  it("update of an unknown id is a not-found", async () => {
    const r = await run([
      "clip-mockup-chapter",
      "update",
      "--title",
      "New",
      "no-such-chapter",
    ]);

    expect(r.exitCode).toBe(2);
    expect(failureOf(r)._tag).toBe("NotFoundError");
  });

  // -----------------------------------------------------------------------
  // move
  // -----------------------------------------------------------------------

  const move = async (id: string, anchor: ReadonlyArray<string>) =>
    run(["clip-mockup-chapter", "move", ...anchor, id]);

  it("move --before repositions against a Clip Mockup id", async () => {
    const mockups = await seedMockups(s.standaloneActiveId, ["one", "two"]);
    const chapter = chapterOf(
      (await add(s.standaloneActiveId, "Wanderer")).stdout
    );

    const r = await move(chapter.id, ["--before", mockups[0]!.id]);

    expect(r.exitCode).toBe(0);
    const moved = chapterOf(r.stdout);
    expect(moved.id).toBe(chapter.id);
    expect(moved.order < mockups[0]!.order).toBe(true);
  });

  it("move --after repositions against another Chapter id", async () => {
    const one1 = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    const two = chapterOf((await add(s.standaloneActiveId, "Two")).stdout);
    const three = chapterOf((await add(s.standaloneActiveId, "Three")).stdout);

    const r = await move(three.id, ["--after", one1.id]);

    expect(r.exitCode).toBe(0);
    const moved = chapterOf(r.stdout);
    expect(moved.order > one1.order).toBe(true);
    expect(moved.order < two.order).toBe(true);
    expect((await list(s.standaloneActiveId)).map((c) => c.name)).toEqual([
      "One",
      "Three",
      "Two",
    ]);
  });

  it("move with no anchor is invalid input, NOT a send-to-the-end", async () => {
    const one1 = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    const two = chapterOf((await add(s.standaloneActiveId, "Two")).stdout);

    const r = await move(one1.id, []);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(r.stdout).toBe("");
    // The refusal moved nothing: the order the resolver would have appended to
    // is still the order it started at.
    expect((await list(s.standaloneActiveId)).map((c) => c.id)).toEqual([
      one1.id,
      two.id,
    ]);
  });

  it("move with both anchors is invalid input", async () => {
    const one1 = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    const two = chapterOf((await add(s.standaloneActiveId, "Two")).stdout);
    const three = chapterOf((await add(s.standaloneActiveId, "Three")).stdout);

    const r = await move(three.id, ["--before", one1.id, "--after", two.id]);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r)._tag).toBe("ParseError");
    expect(r.stdout).toBe("");
  });

  it("move of an unknown Chapter, and to an unknown anchor, are not-founds", async () => {
    const chapter = chapterOf((await add(s.standaloneActiveId, "One")).stdout);

    const badId = await move("no-such-chapter", ["--before", chapter.id]);
    const badAnchor = await move(chapter.id, ["--before", "no-such-row"]);

    expect(badId.exitCode).toBe(2);
    expect(failureOf(badId)._tag).toBe("NotFoundError");
    expect(badAnchor.exitCode).toBe(2);
    expect(failureOf(badAnchor)._tag).toBe("NotFoundError");
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  it("delete archives the Chapter and echoes the archived row", async () => {
    const created = chapterOf((await add(s.standaloneActiveId, "One")).stdout);

    const r = await run(["clip-mockup-chapter", "delete", created.id]);

    expect(r.exitCode).toBe(0);
    expect(chapterOf(r.stdout).archived).toBe(true);
  });

  it("a deleted Chapter never appears in list or get again", async () => {
    const created = chapterOf((await add(s.standaloneActiveId, "One")).stdout);
    await run(["clip-mockup-chapter", "delete", created.id]);

    const got = await run(["clip-mockup-chapter", "get", created.id]);
    const deletedTwice = await run([
      "clip-mockup-chapter",
      "delete",
      created.id,
    ]);
    const updated = await run([
      "clip-mockup-chapter",
      "update",
      "--title",
      "Back",
      created.id,
    ]);

    expect(await list(s.standaloneActiveId)).toEqual([]);
    // Archived means deleted: there is no restore verb, so every verb that
    // addresses it reports a not-found.
    for (const r of [got, deletedTwice, updated]) {
      expect(r.exitCode).toBe(2);
      expect(failureOf(r)._tag).toBe("NotFoundError");
    }
  });
});
