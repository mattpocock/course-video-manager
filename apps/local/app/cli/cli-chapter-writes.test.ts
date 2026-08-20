import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm chapter writes: add / update / move / delete, plus list / get.
//
// Structurally mirrors cli-clip-writes.test.ts. No service faking is needed —
// these are pure DB writes over the RPC transport. Clips (seeded directly, the
// way clip writes are) share the timeline order space with chapters, so the
// positioning tests interleave both.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface ChapterRow {
  id: string;
  videoId: string;
  name: string;
  order: string;
  archived: boolean;
}

interface ClipRow {
  id: string;
}

const chapters = async (videoId: string): Promise<ChapterRow[]> =>
  ndjson(
    (await run(["chapter", "list", "--video", videoId])).stdout
  ) as ChapterRow[];

/** The merged clip+chapter timeline order, as ids. */
const timelineIds = (videoId: string) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    return (yield* clipOps.listTimelineOrder(videoId)).map((i) => i.id);
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

/** Seed a clip directly (chapters share its order space) — no CLI clip creator. */
const seedClip = (videoId: string, after?: string): Promise<ClipRow> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint:
        after === undefined
          ? { type: "start" }
          : { type: "after-clip", databaseClipId: after },
      clips: [{ inputVideo: "test.mkv", startTime: 0, endTime: 1 }],
    });
    return clip as unknown as ClipRow;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

const add = async (
  videoId: string,
  title: string,
  extra: ReadonlyArray<string> = []
): Promise<ChapterRow> =>
  one<ChapterRow>(
    (
      await run([
        "chapter",
        "add",
        "--video",
        videoId,
        "--title",
        title,
        ...extra,
      ])
    ).stdout
  );

describe("chapter add", () => {
  it("adds a chapter with the given title, appended by default", async () => {
    const r = await run([
      "chapter",
      "add",
      "--video",
      s.standaloneActiveId,
      "--title",
      "Introduction",
    ]);
    expect(r.exitCode).toBe(0);
    const chapter = one<ChapterRow>(r.stdout);
    expect(chapter.videoId).toBe(s.standaloneActiveId);
    expect(chapter.name).toBe("Introduction");
    expect(chapter.archived).toBe(false);

    expect((await chapters(s.standaloneActiveId)).map((c) => c.name)).toEqual([
      "Introduction",
    ]);
  });

  it("appends to the end across multiple adds", async () => {
    const a = await add(s.standaloneActiveId, "One");
    const b = await add(s.standaloneActiveId, "Two");
    expect((await chapters(s.standaloneActiveId)).map((c) => c.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("--after a clip opens the chapter right after that clip in the shared order", async () => {
    const c1 = await seedClip(s.standaloneActiveId);
    const c2 = await seedClip(s.standaloneActiveId, c1.id);
    const chapter = await add(s.standaloneActiveId, "Mid", ["--after", c1.id]);

    expect(await timelineIds(s.standaloneActiveId)).toEqual([
      c1.id,
      chapter.id,
      c2.id,
    ]);
  });

  it("--before positions ahead of an existing chapter", async () => {
    const first = await add(s.standaloneActiveId, "First");
    const inserted = await add(s.standaloneActiveId, "Zeroth", [
      "--before",
      first.id,
    ]);
    expect((await chapters(s.standaloneActiveId)).map((c) => c.id)).toEqual([
      inserted.id,
      first.id,
    ]);
  });

  it("both --before and --after => invalid input, exit 3", async () => {
    const c = await add(s.standaloneActiveId, "One");
    const { exitCode, stdout } = await run([
      "chapter",
      "add",
      "--video",
      s.standaloneActiveId,
      "--title",
      "Two",
      "--before",
      c.id,
      "--after",
      c.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("an unknown video => NotFoundError, exit 2", async () => {
    const { exitCode, stderr } = await run([
      "chapter",
      "add",
      "--video",
      "video_nope",
      "--title",
      "X",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "video"
    );
  });
});

describe("chapter update", () => {
  it("renames a chapter", async () => {
    const c = await add(s.standaloneActiveId, "Old");
    const updated = one<ChapterRow>(
      (await run(["chapter", "update", "--title", "New", c.id])).stdout
    );
    expect(updated.id).toBe(c.id);
    expect(updated.name).toBe("New");
  });

  it("an unknown id => NotFoundError, exit 2", async () => {
    const { exitCode } = await run([
      "chapter",
      "update",
      "--title",
      "X",
      "chap_missing",
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("chapter move", () => {
  it("--before jumps to an earlier position", async () => {
    const a = await add(s.standaloneActiveId, "A");
    const b = await add(s.standaloneActiveId, "B");
    const c = await add(s.standaloneActiveId, "C");
    expect((await chapters(s.standaloneActiveId)).map((x) => x.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);

    await run(["chapter", "move", "--before", a.id, c.id]);
    expect((await chapters(s.standaloneActiveId)).map((x) => x.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
  });

  it("--after a clip repositions across the shared order space", async () => {
    const clip = await seedClip(s.standaloneActiveId);
    const chapter = await add(s.standaloneActiveId, "A", ["--before", clip.id]);
    // Currently [chapter, clip]; move the chapter after the clip.
    await run(["chapter", "move", "--after", clip.id, chapter.id]);
    expect(await timelineIds(s.standaloneActiveId)).toEqual([
      clip.id,
      chapter.id,
    ]);
  });

  it("with neither --before nor --after => invalid input, exit 3", async () => {
    const c = await add(s.standaloneActiveId, "A");
    expect((await run(["chapter", "move", c.id])).exitCode).toBe(3);
  });

  it("--before an unknown id => NotFoundError, exit 2", async () => {
    const c = await add(s.standaloneActiveId, "A");
    const { exitCode } = await run([
      "chapter",
      "move",
      "--before",
      "nope",
      c.id,
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("chapter delete", () => {
  it("archives the chapter, hides it from list, no restore", async () => {
    const c = await add(s.standaloneActiveId, "A");
    const del = one<ChapterRow>(
      (await run(["chapter", "delete", c.id])).stdout
    );
    expect(del.id).toBe(c.id);
    expect(del.archived).toBe(true);
    expect(
      (await chapters(s.standaloneActiveId)).map((x) => x.id)
    ).not.toContain(c.id);
  });

  it("any write on an already-deleted chapter => NotFoundError, exit 2", async () => {
    const c = await add(s.standaloneActiveId, "A");
    await run(["chapter", "delete", c.id]);
    expect(
      (await run(["chapter", "update", "--title", "X", c.id])).exitCode
    ).toBe(2);
    expect((await run(["chapter", "delete", c.id])).exitCode).toBe(2);
  });
});

describe("chapter list / get", () => {
  it("list prints nothing (exit 0) for a video with no chapters", async () => {
    const r = await run(["chapter", "list", "--video", s.standaloneActiveId]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("list is a not-found (exit 2) for an unknown video", async () => {
    expect(
      (await run(["chapter", "list", "--video", "video_nope"])).exitCode
    ).toBe(2);
  });

  it("get returns one chapter, and 404s a missing / archived id", async () => {
    const c = await add(s.standaloneActiveId, "A");
    const got = one<ChapterRow>((await run(["chapter", "get", c.id])).stdout);
    expect(got.id).toBe(c.id);

    expect((await run(["chapter", "get", "chap_missing"])).exitCode).toBe(2);

    await run(["chapter", "delete", c.id]);
    expect((await run(["chapter", "get", c.id])).exitCode).toBe(2);
  });

  it("get is variadic and reports missing ids on stderr (exit 2)", async () => {
    const a = await add(s.standaloneActiveId, "A");
    const b = await add(s.standaloneActiveId, "B");
    const r = await run(["chapter", "get", a.id, "nope", b.id]);
    expect(r.exitCode).toBe(2);
    expect(ndjson(r.stdout).map((x) => (x as ChapterRow).id)).toEqual([
      a.id,
      b.id,
    ]);
  });
});
