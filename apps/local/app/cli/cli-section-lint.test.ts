import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import {
  buildReadLayer,
  makeReadRun,
  seedRead,
  type ReadSeed,
  type RunResult,
} from "./cli-read-test-harness";

// ===========================================================================
// cvm section lint — the section-authoring quality bar, enforced.
//
// This verb exists because the bar previously lived only as prose in another
// repo's skill, and an agent kept hand-writing the same throwaway script to
// check the same four things. So each check gets a CLEAN case and a DIRTY
// case here: the dirty case is the exact shape the hand-written script was
// looking for, and the clean case is what stops the check crying wolf.
//
// The read seed gives us: one draft Section, one Lesson ("Welcome"), one
// Video ("intro.mp4") with one active Beat and one archived Beat. Learning
// Goals and further Lessons/Videos/Beats are added per test.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: ReadSeed;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeReadRun(buildReadLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedRead(testDb);
});

/** The seed's single active Beat, whose kind/description each test steers. */
const activeBeat = async () => {
  const beat = await testDb.query.beats.findFirst({
    where: (b, { eq, and }) =>
      and(eq(b.videoId, s.lessonVideoId), eq(b.archived, false)),
  });
  return beat!;
};

const addLearningGoal = async (title: string, order = 1) => {
  const [goal] = await testDb
    .insert(schema.learningGoals)
    .values({ sectionId: s.draftSectionId, title, order })
    .returning();
  return goal!;
};

const link = async (beatId: string, learningGoalId: string) => {
  await testDb
    .insert(schema.beatLearningGoals)
    .values({ beatId, learningGoalId });
};

/** Add a second Lesson with one Video, for the pacing checks. */
const addSecondLesson = async (title: string) => {
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: s.draftSectionId, title, order: 5 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: `${title}.mp4`,
      originalFootagePath: "f.mp4",
    })
    .returning();
  return { lessonId: lesson!.id, videoId: video!.id };
};

const addBeat = async (params: {
  videoId: string;
  kind: "definition" | "quest" | "setup";
  title: string;
  description?: string;
  order: string;
}) => {
  const [beat] = await testDb
    .insert(schema.beats)
    .values({
      videoId: params.videoId,
      kind: params.kind,
      title: params.title,
      description: params.description ?? "a plan",
      order: params.order,
    })
    .returning();
  return beat!;
};

const lint = async () => {
  const res = await run(["section", "lint", s.draftSectionId]);
  expect(res.stderr).toBe("");
  return { res, out: JSON.parse(res.stdout) };
};

describe("section lint", () => {
  // -------------------------------------------------------------------------
  // Check 1 — orphaned Learning Goals
  // -------------------------------------------------------------------------

  it("reports a Learning Goal no Beat serves, with its id and title", async () => {
    const goal = await addLearningGoal("Understand feedback loops");
    // The seed's Beat is linked to nothing, so the Goal is orphaned.
    const { out } = await lint();

    expect(out.counts.orphanedLearningGoals).toBe(1);
    expect(out.orphanedLearningGoals).toEqual([
      { id: goal.id, title: "Understand feedback loops" },
    ]);
    expect(out.failedChecks).toContain("orphanedLearningGoals");
    expect(out.clean).toBe(false);
  });

  it("clears the orphan once a Beat serves the Goal", async () => {
    const goal = await addLearningGoal("Understand feedback loops");
    const beat = await activeBeat();
    await link(beat.id, goal.id);

    const { out } = await lint();

    expect(out.orphanedLearningGoals).toEqual([]);
    expect(out.counts.orphanedLearningGoals).toBe(0);
  });

  // An ARCHIVED Beat must not rescue a Goal: the join row survives the soft
  // delete, so a naive `beatIds.length > 0` would call this served.
  it("still reports the Goal when only an archived Beat links to it", async () => {
    const goal = await addLearningGoal("Understand feedback loops");
    const archived = await testDb.query.beats.findFirst({
      where: (b, { eq, and }) =>
        and(eq(b.videoId, s.lessonVideoId), eq(b.archived, true)),
    });
    await link(archived!.id, goal.id);

    const { out } = await lint();

    expect(out.counts.orphanedLearningGoals).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Check 2 — unlinked Beats
  // -------------------------------------------------------------------------

  it("reports a non-setup Beat serving no Learning Goal, fully addressed", async () => {
    await addLearningGoal("Understand feedback loops");
    const beat = await activeBeat();

    const { out } = await lint();

    expect(out.counts.unlinkedBeats).toBe(1);
    expect(out.unlinkedBeats).toEqual([
      {
        id: beat.id,
        title: "Active beat",
        kind: "definition",
        videoId: s.lessonVideoId,
        videoTitle: "intro.mp4",
        lessonId: s.lessonId,
        lessonTitle: "Welcome",
      },
    ]);
    expect(out.failedChecks).toContain("unlinkedBeats");
  });

  // Both exemptions, because each one on its own would make the check useless
  // in a different way if it were dropped.
  it("exempts a setup Beat, and exempts every Beat while the Section has no Goals", async () => {
    const setupBeat = await addBeat({
      videoId: s.lessonVideoId,
      kind: "setup",
      title: "Clone the playground",
      order: "0005",
    });

    // No Learning Goals in the Section yet: nothing to serve, nothing to warn.
    const before = await lint();
    expect(before.out.unlinkedBeats).toEqual([]);

    // With a Goal present the setup Beat is STILL exempt — only the seed's
    // definition Beat is reported.
    await addLearningGoal("Understand feedback loops");
    const after = await lint();
    expect(after.out.counts.unlinkedBeats).toBe(1);
    expect(
      after.out.unlinkedBeats.map((b: { id: string }) => b.id)
    ).not.toContain(setupBeat.id);
  });

  // -------------------------------------------------------------------------
  // Check 3 — stub Beats
  // -------------------------------------------------------------------------

  it("reports a Beat whose description is empty or whitespace-only", async () => {
    // The seed's Beat is created with the column default: "".
    const empty = await activeBeat();
    const whitespace = await addBeat({
      videoId: s.lessonVideoId,
      kind: "definition",
      title: "Whitespace",
      description: "   \n\t ",
      order: "0005",
    });

    const { out } = await lint();

    expect(out.counts.stubBeats).toBe(2);
    expect(out.stubBeats.map((b: { id: string }) => b.id).sort()).toEqual(
      [empty.id, whitespace.id].sort()
    );
    expect(out.failedChecks).toContain("stubBeats");
  });

  it("does not report a Beat that carries a real description", async () => {
    await testDb
      .update(schema.beats)
      .set({ description: "Show the loop tightening." });

    const { out } = await lint();

    expect(out.stubBeats).toEqual([]);
    expect(out.counts.stubBeats).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Check 4 — quest pacing
  // -------------------------------------------------------------------------

  it("reports the Lesson with no Quest, and the whole distribution", async () => {
    // Two quests bunched into the seed's Lesson; the second Lesson gets none.
    await addBeat({
      videoId: s.lessonVideoId,
      kind: "quest",
      title: "Quest A",
      order: "0005",
    });
    await addBeat({
      videoId: s.lessonVideoId,
      kind: "quest",
      title: "Quest B",
      order: "0006",
    });
    const second = await addSecondLesson("Second");

    const { out } = await lint();

    expect(out.counts.questlessLessons).toBe(1);
    expect(out.questlessLessons).toEqual([
      { id: second.lessonId, title: "Second", quests: 0 },
    ]);
    expect(out.questPacing.totalQuests).toBe(2);
    expect(out.questPacing.lessons).toEqual([
      { id: s.lessonId, title: "Welcome", quests: 2 },
      { id: second.lessonId, title: "Second", quests: 0 },
    ]);
    expect(out.failedChecks).toContain("questlessLessons");
  });

  it("stays quiet on pacing when every Lesson has a Quest", async () => {
    await addBeat({
      videoId: s.lessonVideoId,
      kind: "quest",
      title: "Quest A",
      order: "0005",
    });
    const second = await addSecondLesson("Second");
    await addBeat({
      videoId: second.videoId,
      kind: "quest",
      title: "Quest B",
      order: "0001",
    });

    const { out } = await lint();

    expect(out.questlessLessons).toEqual([]);
    expect(out.questPacing.totalQuests).toBe(2);
  });

  // The whole-Section exemption: an unstarted Section has no quests anywhere,
  // and firing on every Lesson would drown the other three checks.
  it("exempts a Section with no Quest Beat at all", async () => {
    await addSecondLesson("Second");

    const { out } = await lint();

    expect(out.questPacing.totalQuests).toBe(0);
    expect(out.questlessLessons).toEqual([]);
    expect(out.failedChecks).not.toContain("questlessLessons");
  });

  // -------------------------------------------------------------------------
  // The report as a whole
  // -------------------------------------------------------------------------

  it("reports clean:true with every list empty on a fully wired Section", async () => {
    const goal = await addLearningGoal("Understand feedback loops");
    await testDb
      .update(schema.beats)
      .set({ description: "Show the loop tightening." });
    const beat = await activeBeat();
    await link(beat.id, goal.id);
    await addBeat({
      videoId: s.lessonVideoId,
      kind: "quest",
      title: "Try it yourself",
      order: "0005",
    });
    const quest = await testDb.query.beats.findFirst({
      where: (b, { eq }) => eq(b.title, "Try it yourself"),
    });
    await link(quest!.id, goal.id);

    const { res, out } = await lint();

    expect(res.exitCode).toBe(0);
    expect(out.sectionId).toBe(s.draftSectionId);
    expect(out.sectionTitle).toBe("01-intro");
    expect(out.clean).toBe(true);
    expect(out.failedChecks).toEqual([]);
    expect(out.counts).toEqual({
      orphanedLearningGoals: 0,
      unlinkedBeats: 0,
      stubBeats: 0,
      questlessLessons: 0,
    });
  });

  // The load-bearing exit-code decision: findings are DATA. An agent that
  // treated a dirty Section as a command failure would abandon the report it
  // just asked for.
  it("exits 0 even when every check fails", async () => {
    await addLearningGoal("Understand feedback loops");
    await addBeat({
      videoId: s.lessonVideoId,
      kind: "quest",
      title: "Quest A",
      order: "0005",
    });
    await addSecondLesson("Second");

    const { res, out } = await lint();

    expect(res.exitCode).toBe(0);
    expect(out.clean).toBe(false);
    expect(out.failedChecks).toEqual([
      "orphanedLearningGoals",
      "unlinkedBeats",
      "stubBeats",
      "questlessLessons",
    ]);
  });

  it("exits 2 for an unknown section id", async () => {
    const res = await run(["section", "lint", "section_nope"]);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
    expect(JSON.parse(res.stderr)).toMatchObject({
      _tag: "NotFoundError",
      entity: "section",
      id: "section_nope",
    });
  });

  it("exits 2 for an archived section rather than reporting it clean", async () => {
    const res = await run(["section", "lint", s.archivedSectionId]);

    expect(res.exitCode).toBe(2);
    expect(res.stdout).toBe("");
  });
});
