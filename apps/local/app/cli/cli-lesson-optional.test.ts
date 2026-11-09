import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
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
// cvm lesson — the Optional Lesson: `update --optional`, and `get`/`list`
// showing it. An Optional Lesson is one a learner may skip and still finish
// the Course; it reaches course.json as `"optional": true`.
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

interface Lesson {
  id: string;
  title: string;
  priority: number;
  optional: boolean;
}

const get = async (id: string) =>
  one<Lesson>((await run(["lesson", "get", id])).stdout);

describe("the Optional Lesson in cvm lesson", () => {
  it("shows a lesson as required by default", async () => {
    expect((await get(s.lessonId)).optional).toBe(false);
  });

  it("--optional true marks the lesson optional, echoing the row", async () => {
    const { stdout, exitCode } = await run([
      "lesson",
      "update",
      "--optional",
      "true",
      s.lessonId,
    ]);
    expect(exitCode).toBe(0);
    expect(one<Lesson>(stdout).optional).toBe(true);
    expect((await get(s.lessonId)).optional).toBe(true);
  });

  it("--optional false makes it required again", async () => {
    await run(["lesson", "update", "--optional", "true", s.lessonId]);
    await run(["lesson", "update", "--optional", "false", s.lessonId]);
    expect((await get(s.lessonId)).optional).toBe(false);
  });

  it("--optional alone leaves the title and priority untouched", async () => {
    const before = await get(s.lessonId);
    await run(["lesson", "update", "--optional", "true", s.lessonId]);
    const after = await get(s.lessonId);
    expect(after.title).toBe(before.title);
    expect(after.priority).toBe(before.priority);
  });

  it("--title alone leaves the lesson optional", async () => {
    await run(["lesson", "update", "--optional", "true", s.lessonId]);
    await run(["lesson", "update", "--title", "Renamed", s.lessonId]);
    expect((await get(s.lessonId)).optional).toBe(true);
  });

  it("an unknown --optional value => invalid input, exit 3, nothing written", async () => {
    const { exitCode, stdout } = await run([
      "lesson",
      "update",
      "--optional",
      "maybe",
      s.lessonId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((await get(s.lessonId)).optional).toBe(false);
  });

  it("lesson list shows which lessons are optional", async () => {
    await run(["lesson", "update", "--optional", "true", s.lessonId]);
    const { stdout } = await run([
      "lesson",
      "list",
      "--section",
      s.draftSectionId,
    ]);
    const listed = (ndjson(stdout) as Lesson[]).find(
      (lesson) => lesson.id === s.lessonId
    );
    expect(listed?.optional).toBe(true);
  });
});
