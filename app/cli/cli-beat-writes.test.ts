import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm beat writes: add / update / move / delete
// (Split from cli-integration.test.ts to stay under the per-file token budget.)
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

describe("beat writes (add / update / move / delete)", () => {
  interface Seg {
    id: string;
    videoId: string;
    kind: string;
    title: string;
    description: string;
    order: string;
    archived: boolean;
  }
  const obj = (stdout: string): Seg => JSON.parse(stdout) as Seg;
  const list = async (videoId: string): Promise<Seg[]> =>
    ndjson((await run(["beat", "list", "--video", videoId])).stdout) as Seg[];
  const add = async (videoId: string, ...args: string[]): Promise<Seg> =>
    obj((await run(["beat", "add", "--video", videoId, ...args])).stdout);
  const freshVideo = async (path: string): Promise<string> => {
    const [v] = await testDb
      .insert(schema.videos)
      .values({ path, originalFootagePath: "f.mp4" })
      .returning();
    return v!.id;
  };

  it("add appends to the end with defaults, echoing the created row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "add",
      "--video",
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/);
    const seg = obj(stdout);
    expect(seg.videoId).toBe(s.standaloneActiveId);
    expect(seg.kind).toBe("definition");
    expect(seg.title).toBe("");
    expect(seg.description).toBe("");
    expect(seg.archived).toBe(false);
    expect(typeof seg.id).toBe("string");
    expect(typeof seg.order).toBe("string");
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      seg.id,
    ]);
  });

  it("add accepts --kind, --title and --description atomically", async () => {
    const seg = await add(
      s.standaloneActiveId,
      "--kind",
      "quest",
      "--title",
      "Try it",
      "--description",
      "note here"
    );
    expect(seg.kind).toBe("quest");
    expect(seg.title).toBe("Try it");
    expect(seg.description).toBe("note here");
  });

  it("add --before inserts immediately before the anchor", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(
      s.standaloneActiveId,
      "--title",
      "Before",
      "--before",
      anchor.id
    );
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      seg.id,
      anchor.id,
    ]);
  });

  it("add --after inserts immediately after the anchor", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(s.standaloneActiveId, "--after", anchor.id);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      anchor.id,
      seg.id,
    ]);
  });

  it("add with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "add",
      "--video",
      s.standaloneActiveId,
      "--before",
      anchor.id,
      "--after",
      anchor.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("add --before an unknown beat id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "add",
      "--video",
      s.standaloneActiveId,
      "--before",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("beat");
  });

  it("update patches only the fields passed, preserving the rest", async () => {
    const created = await add(
      s.standaloneActiveId,
      "--title",
      "Orig",
      "--description",
      "d0"
    );
    const updated = obj(
      (
        await run([
          "beat",
          "update",
          "--title",
          "New",
          "--kind",
          "walkthrough",
          created.id,
        ])
      ).stdout
    );
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("New");
    expect(updated.kind).toBe("walkthrough");
    expect(updated.description).toBe("d0");
  });

  it("update never repositions or changes the beat's video", async () => {
    const a = await add(s.standaloneActiveId, "--title", "A");
    const b = await add(s.standaloneActiveId, "--title", "B");
    const updated = obj(
      (await run(["beat", "update", "--title", "A2", a.id])).stdout
    );
    expect(updated.videoId).toBe(a.videoId);
    expect(updated.order).toBe(a.order);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("update with no fields => invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId);
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "update",
      created.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("update with a bogus --kind => invalid input, exit 3", async () => {
    const created = await add(s.standaloneActiveId);
    const { exitCode } = await run([
      "beat",
      "update",
      "--kind",
      "bogus",
      created.id,
    ]);
    expect(exitCode).toBe(3);
  });

  it("update an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "update",
      "--title",
      "x",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("beat");
  });

  it("delete archives the beat, echoes archived:true, hides it from list", async () => {
    const created = await add(s.standaloneActiveId, "--title", "Doomed");
    const del = obj((await run(["beat", "delete", created.id])).stdout);
    expect(del.id).toBe(created.id);
    expect(del.archived).toBe(true);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
      created.id
    );
  });

  it("delete an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "delete",
      "seg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "beat"
    );
  });

  it("any write on an already-deleted beat => NotFoundError, exit 2", async () => {
    const created = await add(s.standaloneActiveId);
    await run(["beat", "delete", created.id]);
    expect(
      (await run(["beat", "update", "--title", "x", created.id])).exitCode
    ).toBe(2);
    expect((await run(["beat", "delete", created.id])).exitCode).toBe(2);
    expect(
      (await run(["beat", "move", "--video", s.standaloneActiveId, created.id]))
        .exitCode
    ).toBe(2);
  });

  it("move reorders within the same video (--after)", async () => {
    const a = await add(s.standaloneActiveId, "--title", "A");
    const b = await add(s.standaloneActiveId, "--title", "B");
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
    const moved = obj(
      (
        await run([
          "beat",
          "move",
          "--video",
          s.standaloneActiveId,
          "--after",
          b.id,
          a.id,
        ])
      ).stdout
    );
    expect(moved.id).toBe(a.id);
    expect(moved.videoId).toBe(s.standaloneActiveId);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it("move relocates a beat into another video (append at end)", async () => {
    const target = await freshVideo("seg-writes-target.mp4");
    const existing = await add(target, "--title", "Existing target beat");
    const seg = await add(s.standaloneActiveId, "--title", "Movable");
    const moved = obj(
      (await run(["beat", "move", "--video", target, seg.id])).stdout
    );
    expect(moved.videoId).toBe(target);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).not.toContain(
      seg.id
    );
    const dst = await list(target);
    expect(dst.map((r) => r.id)).toEqual([existing.id, seg.id]);
  });

  it("move with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await add(s.standaloneActiveId, "--title", "Anchor");
    const seg = await add(s.standaloneActiveId, "--title", "Movable");
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "move",
      "--video",
      s.standaloneActiveId,
      "--before",
      anchor.id,
      "--after",
      anchor.id,
      seg.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("move --before an id not in the target video => NotFoundError, exit 2", async () => {
    const seg = await add(s.standaloneActiveId);
    const { stdout, stderr, exitCode } = await run([
      "beat",
      "move",
      "--video",
      s.standaloneActiveId,
      "--before",
      "seg_missing",
      seg.id,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "beat"
    );
  });
});
