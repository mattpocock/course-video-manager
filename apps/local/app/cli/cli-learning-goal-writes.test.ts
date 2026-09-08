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
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm learning-goal writes: create / update / move / delete
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

describe("learning-goal writes (create / update / move / delete)", () => {
  interface Goal {
    id: string;
    sectionId: string;
    title: string;
    description: string;
    priority: number;
    order: number;
    beatIds: string[];
    archived: boolean;
  }
  const obj = (stdout: string): Goal => JSON.parse(stdout) as Goal;
  const list = async (sectionId: string): Promise<Goal[]> =>
    ndjson(
      (await run(["learning-goal", "list", "--section", sectionId])).stdout
    ) as Goal[];
  const create = async (sectionId: string, ...args: string[]): Promise<Goal> =>
    obj(
      (await run(["learning-goal", "create", "--section", sectionId, ...args]))
        .stdout
    );
  const addBeat = async (videoId: string): Promise<string> =>
    (
      JSON.parse((await run(["beat", "add", "--video", videoId])).stdout) as {
        id: string;
      }
    ).id;

  it("create appends to the end with defaults, echoing the created row", async () => {
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "create",
      "--section",
      s.draftSectionId,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\{\n/);
    const goal = obj(stdout);
    expect(goal.sectionId).toBe(s.draftSectionId);
    expect(goal.title).toBe("");
    expect(goal.description).toBe("");
    expect(goal.priority).toBe(2);
    expect(goal.archived).toBe(false);
    expect(typeof goal.id).toBe("string");
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([goal.id]);
  });

  it("create accepts --title, --description and --priority atomically", async () => {
    const goal = await create(
      s.draftSectionId,
      "--title",
      "Explain closures",
      "--description",
      "The learner can describe lexical scoping.",
      "--priority",
      "1"
    );
    expect(goal.title).toBe("Explain closures");
    expect(goal.description).toBe("The learner can describe lexical scoping.");
    expect(goal.priority).toBe(1);
  });

  it("create --before inserts immediately before the anchor", async () => {
    const anchor = await create(s.draftSectionId, "--title", "Anchor");
    const goal = await create(
      s.draftSectionId,
      "--title",
      "Before",
      "--before",
      anchor.id
    );
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      goal.id,
      anchor.id,
    ]);
  });

  it("create --after inserts immediately after the anchor", async () => {
    const anchor = await create(s.draftSectionId, "--title", "Anchor");
    const goal = await create(s.draftSectionId, "--after", anchor.id);
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      anchor.id,
      goal.id,
    ]);
  });

  it("create with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await create(s.draftSectionId, "--title", "Anchor");
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "create",
      "--section",
      s.draftSectionId,
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

  it("create --before an unknown goal id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "create",
      "--section",
      s.draftSectionId,
      "--before",
      "lg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("learningGoal");
  });

  it("get returns a single goal as one pretty object", async () => {
    const created = await create(s.draftSectionId, "--title", "Solo");
    const { stdout, exitCode } = await run([
      "learning-goal",
      "get",
      created.id,
    ]);
    expect(exitCode).toBe(0);
    expect(obj(stdout).id).toBe(created.id);
  });

  it("get an unknown id => NotFoundError, exit 2", async () => {
    const { exitCode, stderr } = await run([
      "learning-goal",
      "get",
      "lg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "learningGoal"
    );
  });

  it("update patches only the fields passed, preserving the rest", async () => {
    const created = await create(
      s.draftSectionId,
      "--title",
      "Orig",
      "--description",
      "d0"
    );
    const updated = obj(
      (
        await run([
          "learning-goal",
          "update",
          "--title",
          "New",
          "--priority",
          "1",
          created.id,
        ])
      ).stdout
    );
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("New");
    expect(updated.priority).toBe(1);
    expect(updated.description).toBe("d0");
  });

  it("update never repositions the goal", async () => {
    const a = await create(s.draftSectionId, "--title", "A");
    const b = await create(s.draftSectionId, "--title", "B");
    const updated = obj(
      (await run(["learning-goal", "update", "--title", "A2", a.id])).stdout
    );
    expect(updated.order).toBe(a.order);
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("update with no fields => invalid input, exit 3", async () => {
    const created = await create(s.draftSectionId);
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "update",
      created.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("update an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "update",
      "--title",
      "x",
      "lg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("learningGoal");
  });

  it("update --unlink-beat removes just that one Beat's link", async () => {
    const goal = await create(s.draftSectionId, "--title", "Goal");
    const beatA = await addBeat(s.lessonVideoId);
    const beatB = await addBeat(s.lessonVideoId);
    await run(["beat", "update", "--learning-goal", goal.id, beatA]);
    await run(["beat", "update", "--learning-goal", goal.id, beatB]);

    const updated = obj(
      (await run(["learning-goal", "update", "--unlink-beat", beatA, goal.id]))
        .stdout
    );

    expect(updated.beatIds).toEqual([beatB]);
  });

  it("update --unlink-beat is the cleanup path for an already-deleted Beat", async () => {
    const goal = await create(s.draftSectionId, "--title", "Goal");
    const beat = await addBeat(s.lessonVideoId);
    await run(["beat", "update", "--learning-goal", goal.id, beat]);
    await run(["beat", "delete", beat]);
    // The dangling reference is already invisible on read (defense in depth)...
    expect(
      (
        JSON.parse((await run(["learning-goal", "get", goal.id])).stdout) as {
          beatIds: string[];
        }
      ).beatIds
    ).toEqual([]);

    // ...and --unlink-beat succeeds even though `beat` no longer resolves to
    // an active Beat, cleaning up the join row for good.
    const { exitCode, stdout } = await run([
      "learning-goal",
      "update",
      "--unlink-beat",
      beat,
      goal.id,
    ]);
    expect(exitCode).toBe(0);
    expect(obj(stdout).beatIds).toEqual([]);
  });

  it("update --unlink-beat is idempotent when the Beat was never linked", async () => {
    const goal = await create(s.draftSectionId, "--title", "Goal");

    const { exitCode, stdout } = await run([
      "learning-goal",
      "update",
      "--unlink-beat",
      "seg_never_linked",
      goal.id,
    ]);

    expect(exitCode).toBe(0);
    expect(obj(stdout).beatIds).toEqual([]);
  });

  it("update --unlink-beat combines with a content patch in one call", async () => {
    const goal = await create(s.draftSectionId, "--title", "Old title");
    const beat = await addBeat(s.lessonVideoId);
    await run(["beat", "update", "--learning-goal", goal.id, beat]);

    const updated = obj(
      (
        await run([
          "learning-goal",
          "update",
          "--title",
          "New title",
          "--unlink-beat",
          beat,
          goal.id,
        ])
      ).stdout
    );

    expect(updated.title).toBe("New title");
    expect(updated.beatIds).toEqual([]);
  });

  it("update --unlink-beat on an unknown Learning Goal id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "update",
      "--unlink-beat",
      "seg_1",
      "lg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const err = JSON.parse(stderr.trim()) as { _tag: string; entity: string };
    expect(err._tag).toBe("NotFoundError");
    expect(err.entity).toBe("learningGoal");
  });

  it("delete archives the goal, echoes archived:true, hides it from list", async () => {
    const created = await create(s.draftSectionId, "--title", "Doomed");
    const del = obj(
      (await run(["learning-goal", "delete", created.id])).stdout
    );
    expect(del.id).toBe(created.id);
    expect(del.archived).toBe(true);
    expect((await list(s.draftSectionId)).map((r) => r.id)).not.toContain(
      created.id
    );
  });

  it("delete an unknown id => NotFoundError, exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "delete",
      "lg_missing",
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "learningGoal"
    );
  });

  it("any write on an already-deleted goal => NotFoundError, exit 2", async () => {
    const created = await create(s.draftSectionId);
    await run(["learning-goal", "delete", created.id]);
    expect(
      (await run(["learning-goal", "update", "--title", "x", created.id]))
        .exitCode
    ).toBe(2);
    expect((await run(["learning-goal", "delete", created.id])).exitCode).toBe(
      2
    );
    expect((await run(["learning-goal", "move", created.id])).exitCode).toBe(2);
  });

  it("move reorders within the same section (--after)", async () => {
    const a = await create(s.draftSectionId, "--title", "A");
    const b = await create(s.draftSectionId, "--title", "B");
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
    const moved = obj(
      (await run(["learning-goal", "move", "--after", b.id, a.id])).stdout
    );
    expect(moved.id).toBe(a.id);
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it("move to the end when no anchor is passed", async () => {
    const a = await create(s.draftSectionId, "--title", "A");
    const b = await create(s.draftSectionId, "--title", "B");
    await run(["learning-goal", "move", a.id]);
    expect((await list(s.draftSectionId)).map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it("move with both --before and --after => invalid input, exit 3", async () => {
    const anchor = await create(s.draftSectionId, "--title", "Anchor");
    const goal = await create(s.draftSectionId, "--title", "Movable");
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "move",
      "--before",
      anchor.id,
      "--after",
      anchor.id,
      goal.id,
    ]);
    expect(exitCode).toBe(3);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("move --before an id not in the same section => NotFoundError, exit 2", async () => {
    const goal = await create(s.draftSectionId);
    const { stdout, stderr, exitCode } = await run([
      "learning-goal",
      "move",
      "--before",
      "lg_missing",
      goal.id,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "learningGoal"
    );
  });
});
