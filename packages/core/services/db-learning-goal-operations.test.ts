import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { LearningGoalOperationsService } from "./db-learning-goal-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  beatLearningGoals,
  beats,
  courses,
  courseVersions,
  learningGoals,
  sections,
  videos,
  type CourseVersionCommitState,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<LearningGoalOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = LearningGoalOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

/** A CourseVersion (Draft by default — the only state that accepts writes) plus its Section. */
const makeSection = async (
  sectionId: string,
  order = 1,
  commitState: CourseVersionCommitState = "draft"
) => {
  const [course] = await testDb
    .insert(courses)
    .values({ name: `course-${sectionId}` })
    .returning();
  const [version] = await testDb
    .insert(courseVersions)
    .values({ repoId: course!.id, name: "v1", commitState })
    .returning();
  await testDb.insert(sections).values({
    id: sectionId,
    repoVersionId: version!.id,
    order,
  });
  return version!;
};

/** Flip a Section's owning CourseVersion to Published, after any Draft-only setup. */
const publishVersionOf = async (sectionId: string) => {
  const [section] = await testDb
    .select({ repoVersionId: sections.repoVersionId })
    .from(sections)
    .where(eq(sections.id, sectionId));
  await testDb
    .update(courseVersions)
    .set({ commitState: "published" })
    .where(eq(courseVersions.id, section!.repoVersionId));
};

describe("createLearningGoal", () => {
  it.effect("defaults to an empty title/description and priority 2", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;

      const goal = yield* svc.createLearningGoal("section-1");

      expect(goal.title).toBe("");
      expect(goal.description).toBe("");
      expect(goal.priority).toBe(2);
      expect(goal.sectionId).toBe("section-1");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("stores the provided fields", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;

      const goal = yield* svc.createLearningGoal("section-1", {
        title: "Explain closures",
        description: "The learner can describe lexical scoping.",
        priority: 1,
      });

      expect(goal.title).toBe("Explain closures");
      expect(goal.description).toBe(
        "The learner can describe lexical scoping."
      );
      expect(goal.priority).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("slots new goals at the end, in creation order", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;

      const first = yield* svc.createLearningGoal("section-1", {
        title: "first",
      });
      const second = yield* svc.createLearningGoal("section-1", {
        title: "second",
      });
      const third = yield* svc.createLearningGoal("section-1", {
        title: "third",
      });

      expect(first.order).toBeLessThan(second.order);
      expect(second.order).toBeLessThan(third.order);

      const listed = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(listed.map((g) => g.id)).toEqual([first.id, second.id, third.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "inserts before the anchor goal when given beforeLearningGoalId",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeSection("section-1"));
        const svc = yield* LearningGoalOperationsService;

        const first = yield* svc.createLearningGoal("section-1");
        const third = yield* svc.createLearningGoal("section-1");
        const second = yield* svc.createLearningGoal("section-1", {}, third.id);

        const listed = yield* svc.listLearningGoalsBySectionId("section-1");
        expect(listed.map((g) => g.id)).toEqual([
          first.id,
          second.id,
          third.id,
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when beforeLearningGoalId does not exist", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;

      const result = yield* svc
        .createLearningGoal("section-1", {}, "missing")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the section's version is not a Draft", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1", 1, "published"));
      const svc = yield* LearningGoalOperationsService;

      const result = yield* svc
        .createLearningGoal("section-1")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("scopes order to each section independently", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      yield* Effect.promise(() => makeSection("section-2"));
      const svc = yield* LearningGoalOperationsService;

      yield* svc.createLearningGoal("section-1");
      yield* svc.createLearningGoal("section-2");

      const s1 = yield* svc.listLearningGoalsBySectionId("section-1");
      const s2 = yield* svc.listLearningGoalsBySectionId("section-2");
      expect(s1).toHaveLength(1);
      expect(s2).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateLearningGoal", () => {
  it.effect("patches only the provided fields", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const created = yield* svc.createLearningGoal("section-1", {
        title: "Explain closures",
        description: "original",
        priority: 2,
      });

      const updated = yield* svc.updateLearningGoal(created.id, {
        priority: 1,
      });

      expect(updated.title).toBe("Explain closures");
      expect(updated.description).toBe("original");
      expect(updated.priority).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("renames via the title field", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const created = yield* svc.createLearningGoal("section-1");

      const updated = yield* svc.updateLearningGoal(created.id, {
        title: "Renamed goal",
      });

      expect(updated.title).toBe("Renamed goal");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the learning goal does not exist", () =>
    Effect.gen(function* () {
      const svc = yield* LearningGoalOperationsService;
      const result = yield* svc
        .updateLearningGoal("missing", { title: "x" })
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails once the owning version is no longer a Draft", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const created = yield* svc.createLearningGoal("section-1");
      yield* Effect.promise(() => publishVersionOf("section-1"));

      const result = yield* svc
        .updateLearningGoal(created.id, { title: "x" })
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("deleteLearningGoal", () => {
  it.effect("archives the goal instead of hard-deleting", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const created = yield* svc.createLearningGoal("section-1");

      yield* svc.deleteLearningGoal(created.id);

      const remaining = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(remaining).toHaveLength(0);

      const row = yield* Effect.promise(() =>
        testDb.query.learningGoals.findFirst({
          where: eq(learningGoals.id, created.id),
        })
      );
      expect(row).toBeDefined();
      expect(row!.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived goals from listLearningGoalsBySectionId", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const a = yield* svc.createLearningGoal("section-1");
      const b = yield* svc.createLearningGoal("section-1");

      yield* svc.deleteLearningGoal(a.id);

      const listed = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(b.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails once the owning version is no longer a Draft", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const created = yield* svc.createLearningGoal("section-1");
      yield* Effect.promise(() => publishVersionOf("section-1"));

      const result = yield* svc
        .deleteLearningGoal(created.id)
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("moveLearningGoal", () => {
  it.effect("reorders within a section, landing between neighbours", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const a = yield* svc.createLearningGoal("section-1");
      const b = yield* svc.createLearningGoal("section-1");
      const c = yield* svc.createLearningGoal("section-1");

      // Move c to sit before b -> order a, c, b.
      yield* svc.moveLearningGoal(c.id, b.id);

      const listed = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(listed.map((g) => g.id)).toEqual([a.id, c.id, b.id]);
      const moved = listed.find((g) => g.id === c.id)!;
      expect(a.order).toBeLessThan(moved.order);
      expect(moved.order).toBeLessThan(b.order);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("appends to the end when beforeLearningGoalId is null", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const a = yield* svc.createLearningGoal("section-1");
      const b = yield* svc.createLearningGoal("section-1");

      yield* svc.moveLearningGoal(a.id, null);

      const listed = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(listed.map((g) => g.id)).toEqual([b.id, a.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when beforeLearningGoalId does not exist", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const a = yield* svc.createLearningGoal("section-1");

      const result = yield* svc
        .moveLearningGoal(a.id, "missing")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the learning goal does not exist", () =>
    Effect.gen(function* () {
      const svc = yield* LearningGoalOperationsService;
      const result = yield* svc
        .moveLearningGoal("missing", null)
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails once the owning version is no longer a Draft", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const a = yield* svc.createLearningGoal("section-1");
      yield* svc.createLearningGoal("section-1");
      yield* Effect.promise(() => publishVersionOf("section-1"));

      const result = yield* svc
        .moveLearningGoal(a.id, null)
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("beatIds", () => {
  /** A Beat, in its own Video, serving the given Learning Goal. */
  const makeBeatServing = async (beatId: string, learningGoalId: string) => {
    await testDb.insert(videos).values({
      id: `${beatId}-video`,
      title: `${beatId}.mp4`,
      originalFootagePath: `/footage/${beatId}`,
    });
    await testDb
      .insert(beats)
      .values({ id: beatId, videoId: `${beatId}-video`, order: "a0" });
    await testDb.insert(beatLearningGoals).values({ beatId, learningGoalId });
  };

  it.effect("is empty for a Learning Goal no Beat serves yet", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const goal = yield* svc.createLearningGoal("section-1");

      expect(goal.beatIds).toEqual([]);
      const fetched = yield* svc.getLearningGoalById(goal.id);
      expect(fetched.beatIds).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("lists every Beat serving the goal, on get and on list", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeSection("section-1"));
      const svc = yield* LearningGoalOperationsService;
      const goal = yield* svc.createLearningGoal("section-1");
      yield* Effect.promise(() => makeBeatServing("beat-1", goal.id));
      yield* Effect.promise(() => makeBeatServing("beat-2", goal.id));

      const fetched = yield* svc.getLearningGoalById(goal.id);
      expect(new Set(fetched.beatIds)).toEqual(new Set(["beat-1", "beat-2"]));

      const listed = yield* svc.listLearningGoalsBySectionId("section-1");
      expect(new Set(listed[0]!.beatIds)).toEqual(
        new Set(["beat-1", "beat-2"])
      );
    }).pipe(Effect.provide(testLayer))
  );
});
