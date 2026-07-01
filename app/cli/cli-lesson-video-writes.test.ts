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

// ===========================================================================
// cvm WRITE verbs — lesson create + video create/move/update
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

describe("lesson create (ghost)", () => {
  interface Lesson {
    id: string;
    sectionId: string;
    title: string;
    path: string;
    order: number;
    fsStatus: string;
    authoringStatus: string | null;
    archived: boolean;
  }

  it("creates a ghost lesson appended to the section, echoing the row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "lesson",
      "create",
      "--section",
      s.draftSectionId,
      "--title",
      "Intro to Effect",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/); // single pretty object, not NDJSON
    const lesson = one<Lesson>(stdout);
    expect(lesson.sectionId).toBe(s.draftSectionId);
    expect(lesson.title).toBe("Intro to Effect");
    expect(lesson.path).toBe("intro-to-effect"); // slugified
    expect(lesson.fsStatus).toBe("ghost");
    expect(lesson.authoringStatus).toBeNull(); // ghosts have no authoring status
    expect(lesson.archived).toBe(false);
    expect(lesson.order).toBeGreaterThan(1); // appended after the seed lesson
    const list = ndjson(
      (await run(["lesson", "list", "--section", s.draftSectionId])).stdout
    ) as Lesson[];
    expect(list.map((l) => l.id)).toContain(lesson.id);
  });

  it("--before places the new lesson before the anchor", async () => {
    const before = one<Lesson>(
      (
        await run([
          "lesson",
          "create",
          "--section",
          s.draftSectionId,
          "--title",
          "Goes First",
          "--before",
          s.lessonId,
        ])
      ).stdout
    );
    const list = ndjson(
      (await run(["lesson", "list", "--section", s.draftSectionId])).stdout
    ) as Lesson[];
    const ids = list.map((l) => l.id);
    expect(ids.indexOf(before.id)).toBeLessThan(ids.indexOf(s.lessonId));
  });

  it("--after places the new lesson after the anchor", async () => {
    const after = one<Lesson>(
      (
        await run([
          "lesson",
          "create",
          "--section",
          s.draftSectionId,
          "--title",
          "Goes After",
          "--after",
          s.lessonId,
        ])
      ).stdout
    );
    const list = ndjson(
      (await run(["lesson", "list", "--section", s.draftSectionId])).stdout
    ) as Lesson[];
    const ids = list.map((l) => l.id);
    expect(ids.indexOf(after.id)).toBeGreaterThan(ids.indexOf(s.lessonId));
  });

  it("both --before and --after => invalid input, exit 3", async () => {
    const { exitCode, stdout, stderr } = await run([
      "lesson",
      "create",
      "--section",
      s.draftSectionId,
      "--title",
      "X",
      "--before",
      s.lessonId,
      "--after",
      s.lessonId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("unknown section => NotFoundError(section), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "create",
      "--section",
      "sec_missing",
      "--title",
      "X",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "section"
    );
  });

  it("unknown anchor => NotFoundError(lesson), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "lesson",
      "create",
      "--section",
      s.draftSectionId,
      "--title",
      "X",
      "--before",
      "les_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "lesson"
    );
  });

  it("a slug that collides with an existing lesson => invalid input, exit 3", async () => {
    await run([
      "lesson",
      "create",
      "--section",
      s.draftSectionId,
      "--title",
      "Duplicate",
    ]);
    const { exitCode, stdout } = await run([
      "lesson",
      "create",
      "--section",
      s.draftSectionId,
      "--title",
      "Duplicate",
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });
});

describe("video create / move / update", () => {
  interface Video {
    id: string;
    path: string;
    lessonId: string | null;
    pitchId: string | null;
    archived: boolean;
  }
  const vobj = (stdout: string): Video => one<Video>(stdout);

  it("create --name (standalone) has no lesson or pitch parent", async () => {
    const { stdout, stderr, exitCode } = await run([
      "video",
      "create",
      "--name",
      "New Standalone",
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const v = vobj(stdout);
    expect(v.path).toBe("New Standalone");
    expect(v.lessonId).toBeNull();
    expect(v.pitchId).toBeNull();
    expect(v.archived).toBe(false);
  });

  it("create --lesson attaches to the lesson", async () => {
    const v = vobj(
      (
        await run([
          "video",
          "create",
          "--name",
          "02-part",
          "--lesson",
          s.lessonId,
        ])
      ).stdout
    );
    expect(v.lessonId).toBe(s.lessonId);
    expect(v.pitchId).toBeNull();
  });

  it("create --pitch attaches to the pitch, name required and honored", async () => {
    const v = vobj(
      (
        await run([
          "video",
          "create",
          "--name",
          "My Pitch Cut",
          "--pitch",
          s.pitchActiveId,
        ])
      ).stdout
    );
    expect(v.pitchId).toBe(s.pitchActiveId);
    expect(v.lessonId).toBeNull();
    expect(v.path).toBe("My Pitch Cut");
  });

  it("create with missing --name => invalid input, exit 3", async () => {
    const { exitCode } = await run(["video", "create"]);
    expect(exitCode).toBe(3);
  });

  it("create with an empty --name => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run(["video", "create", "--name", "  "]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("create with both --lesson and --pitch => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run([
      "video",
      "create",
      "--name",
      "X",
      "--lesson",
      s.lessonId,
      "--pitch",
      s.pitchActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("create --lesson with unknown lesson => NotFoundError(lesson), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "video",
      "create",
      "--name",
      "X",
      "--lesson",
      "les_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "lesson"
    );
  });

  it("create --pitch with unknown pitch => NotFoundError(pitch), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "video",
      "create",
      "--name",
      "X",
      "--pitch",
      "pit_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "pitch"
    );
  });

  it("create --lesson with a name already taken in the lesson => invalid input, exit 3", async () => {
    // s.lessonVideoId already has path "intro.mp4" in the lesson.
    const { exitCode, stdout } = await run([
      "video",
      "create",
      "--name",
      "intro.mp4",
      "--lesson",
      s.lessonId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("move re-homes a standalone video into a lesson", async () => {
    const moved = vobj(
      (
        await run([
          "video",
          "move",
          "--lesson",
          s.lessonId,
          s.standaloneActiveId,
        ])
      ).stdout
    );
    expect(moved.id).toBe(s.standaloneActiveId);
    expect(moved.lessonId).toBe(s.lessonId);
    expect(moved.pitchId).toBeNull();
  });

  it("move to a pitch clears any lesson parent (single-parent invariant)", async () => {
    const moved = vobj(
      (
        await run([
          "video",
          "move",
          "--pitch",
          s.pitchActiveId,
          s.lessonVideoId,
        ])
      ).stdout
    );
    expect(moved.id).toBe(s.lessonVideoId);
    expect(moved.pitchId).toBe(s.pitchActiveId);
    expect(moved.lessonId).toBeNull(); // lesson association cleared
  });

  it("move with neither --lesson nor --pitch => invalid input, exit 3", async () => {
    const { exitCode } = await run(["video", "move", s.standaloneActiveId]);
    expect(exitCode).toBe(3);
  });

  it("move with both --lesson and --pitch => invalid input, exit 3", async () => {
    const { exitCode } = await run([
      "video",
      "move",
      "--lesson",
      s.lessonId,
      "--pitch",
      s.pitchActiveId,
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(3);
  });

  it("move an unknown video => NotFoundError(video), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "video",
      "move",
      "--lesson",
      s.lessonId,
      "vid_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "video"
    );
  });

  it("move into a lesson where the name is taken => invalid input, exit 3", async () => {
    // Rename the standalone video to collide with the existing lesson video,
    // then try to move it into that lesson.
    await run(["video", "update", "--name", "intro.mp4", s.standaloneActiveId]);
    const { exitCode, stdout } = await run([
      "video",
      "move",
      "--lesson",
      s.lessonId,
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("update --name renames the video, echoing the row", async () => {
    const updated = vobj(
      (
        await run([
          "video",
          "update",
          "--name",
          "renamed.mp4",
          s.standaloneActiveId,
        ])
      ).stdout
    );
    expect(updated.id).toBe(s.standaloneActiveId);
    expect(updated.path).toBe("renamed.mp4");
  });

  it("update with no --name => invalid input, exit 3", async () => {
    const { exitCode } = await run(["video", "update", s.standaloneActiveId]);
    expect(exitCode).toBe(3);
  });

  it("update with an empty --name => invalid input, exit 3", async () => {
    const { exitCode, stdout } = await run([
      "video",
      "update",
      "--name",
      "  ",
      s.standaloneActiveId,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
  });

  it("update an unknown video => NotFoundError(video), exit 2", async () => {
    const { exitCode, stderr } = await run([
      "video",
      "update",
      "--name",
      "x",
      "vid_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "video"
    );
  });
});
