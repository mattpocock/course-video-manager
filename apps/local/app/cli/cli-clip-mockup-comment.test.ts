import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm clip-mockup-comment: the author's notes on a Clip Mockup or a Clip
// Mockup Chapter. Every case writes to the lesson-bound Video, which sits in a
// Draft Course Version, because every write here goes through the Draft guard.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;

interface CommentRow {
  id: string;
  videoId: string;
  clipMockupId: string | null;
  clipMockupChapterId: string | null;
  body: string;
}

const failureOf = (result: RunResult) =>
  JSON.parse(result.stderr.trim()) as { _tag: string };

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeRun(buildWriteLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

const seedParents = async (videoId: string) => {
  const [clipMockup] = await testDb
    .insert(schema.clipMockups)
    .values({
      videoId,
      line: "Here's the problem.",
      imagePath: "a.png",
      audioPath: "a.wav",
      durationSeconds: 1,
      order: "a1",
    })
    .returning();
  const [chapter] = await testDb
    .insert(schema.clipMockupChapters)
    .values({ videoId, name: "Setup", order: "a0" })
    .returning();
  return { clipMockup: clipMockup!, chapter: chapter! };
};

describe("cvm clip-mockup-comment", () => {
  it("adds to a Clip Mockup and a Chapter, then lists both", async () => {
    const { clipMockup, chapter } = await seedParents(s.lessonVideoId);

    const onMockup = await run([
      "clip-mockup-comment",
      "add",
      "--clip-mockup",
      clipMockup.id,
      "--body",
      "Say this slower.",
    ]);
    expect(onMockup.exitCode).toBe(0);
    expect(one<CommentRow>(onMockup.stdout)).toMatchObject({
      videoId: s.lessonVideoId,
      clipMockupId: clipMockup.id,
      clipMockupChapterId: null,
      body: "Say this slower.",
    });

    const onChapter = await run([
      "clip-mockup-comment",
      "add",
      "--clip-mockup-chapter",
      chapter.id,
      "--body",
      "Film this part last.",
    ]);
    expect(onChapter.exitCode).toBe(0);

    const listed = ndjson(
      (await run(["clip-mockup-comment", "list", "--video", s.lessonVideoId]))
        .stdout
    ) as CommentRow[];
    expect(listed.map((c) => c.body).sort()).toEqual([
      "Film this part last.",
      "Say this slower.",
    ]);
  });

  it("add needs exactly one parent flag", async () => {
    const { clipMockup, chapter } = await seedParents(s.lessonVideoId);

    const neither = await run(["clip-mockup-comment", "add", "--body", "x"]);
    const both = await run([
      "clip-mockup-comment",
      "add",
      "--clip-mockup",
      clipMockup.id,
      "--clip-mockup-chapter",
      chapter.id,
      "--body",
      "x",
    ]);

    expect(neither.exitCode).toBe(3);
    expect(both.exitCode).toBe(3);
  });

  it("an unknown parent is a not-found", async () => {
    const result = await run([
      "clip-mockup-comment",
      "add",
      "--clip-mockup",
      "no-such-id",
      "--body",
      "x",
    ]);

    expect(result.exitCode).toBe(2);
    expect(failureOf(result)._tag).toBe("NotFoundError");
  });

  it("update replaces the body and delete removes the row", async () => {
    const { clipMockup } = await seedParents(s.lessonVideoId);
    const created = one<CommentRow>(
      (
        await run([
          "clip-mockup-comment",
          "add",
          "--clip-mockup",
          clipMockup.id,
          "--body",
          "before",
        ])
      ).stdout
    );

    const updated = await run([
      "clip-mockup-comment",
      "update",
      "--body",
      "after",
      created.id,
    ]);
    expect(updated.exitCode).toBe(0);
    expect(one<CommentRow>(updated.stdout).body).toBe("after");

    const deleted = await run(["clip-mockup-comment", "delete", created.id]);
    expect(deleted.exitCode).toBe(0);
    expect(one<CommentRow>(deleted.stdout)).toMatchObject({
      id: created.id,
      body: "after",
    });
    const rows = await testDb.query.clipMockupComments.findMany({
      where: eq(schema.clipMockupComments.id, created.id),
    });
    expect(rows).toEqual([]);

    const gone = await run(["clip-mockup-comment", "get", created.id]);
    expect(gone.exitCode).toBe(2);
  });

  it("update and delete of an unknown id are a not-found", async () => {
    const update = await run([
      "clip-mockup-comment",
      "update",
      "--body",
      "x",
      "no-such-id",
    ]);
    const del = await run(["clip-mockup-comment", "delete", "no-such-id"]);

    expect(update.exitCode).toBe(2);
    expect(del.exitCode).toBe(2);
  });
});
