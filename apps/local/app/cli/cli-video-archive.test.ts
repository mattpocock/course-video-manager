import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import * as schema from "@/db/schema";

// ===========================================================================
// cvm WRITE verb — `video archive`, the Video soft delete.
//
// Its own file (rather than cli-lesson-video-writes.test.ts, which holds the
// other video write verbs) only because that one is at the repo's per-file
// token budget.
//
// What the verb has to get right, and what each test below pins:
//   - it archives BOTH kinds of Video, and the two kinds disappear into
//     different places — a Standalone one into `video list --archived`, a
//     lesson-bound one out of its Lesson entirely;
//   - an archived Video is still READABLE by id, so re-archiving one is
//     invalid input (exit 3), not the not-found `lesson archive` answers with;
//   - the Draft guard still applies: a Video in a published Version is frozen.
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

describe("video archive", () => {
  interface Video {
    id: string;
    title: string;
    lessonId: string | null;
    archived: boolean;
  }
  const vobj = (stdout: string): Video => one<Video>(stdout);

  it("archives a standalone video, echoing the archived row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "archive",
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const archived = vobj(stdout);
    expect(archived.id).toBe(s.standaloneActiveId);
    expect(archived.archived).toBe(true);
  });

  it("moves the video out of 'list' and into 'list --archived'", async () => {
    await run(["video", "archive", s.standaloneActiveId]);

    const active = ndjson((await run(["video", "list"])).stdout) as Video[];
    expect(active.map((v) => v.id)).not.toContain(s.standaloneActiveId);

    const archive = ndjson(
      (await run(["video", "list", "--archived"])).stdout
    ) as Video[];
    expect(archive.map((v) => v.id)).toContain(s.standaloneActiveId);
  });

  it("archives a lesson-bound video, hiding it from its lesson", async () => {
    const { exitCode, stdout } = await run([
      "video",
      "archive",
      s.lessonVideoId,
    ]);
    expect(exitCode).toBe(0);
    expect(vobj(stdout).archived).toBe(true);

    const tree = one<{ children?: ReadonlyArray<{ id: string }> }>(
      (await run(["lesson", "tree", s.lessonId])).stdout
    );
    expect((tree.children ?? []).map((c) => c.id)).not.toContain(
      s.lessonVideoId
    );
  });

  it("an unknown id => NotFoundError(video), exit 2", async () => {
    const { exitCode, stderr } = await run(["video", "archive", "vid_missing"]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "video"
    );
  });

  it("an already-archived video => invalid input, exit 3", async () => {
    const { exitCode, stdout, stderr } = await run([
      "video",
      "archive",
      s.standaloneArchivedId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("refuses a video in a published (frozen) version (exit 3)", async () => {
    const [oldCourse] = await testDb
      .insert(schema.courses)
      .values({ name: "Frozen", slug: "frozen-course" })
      .returning();
    const [oldVersion] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: oldCourse!.id, name: "v1", commitState: "published" })
      .returning();
    const [oldSection] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: oldVersion!.id, title: "01-old", order: 1 })
      .returning();
    const [oldLesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId: oldSection!.id, title: "Old One", order: 1 })
      .returning();
    const [oldVideo] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: oldLesson!.id,
        title: "frozen.mp4",
        originalFootagePath: "f.mp4",
      })
      .returning();

    const { exitCode, stdout } = await run(["video", "archive", oldVideo!.id]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");

    // The row is untouched — a refused write leaves nothing half-done.
    expect(
      vobj((await run(["video", "get", oldVideo!.id])).stdout).archived
    ).toBe(false);
  });
});
