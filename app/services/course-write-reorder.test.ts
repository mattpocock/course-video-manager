import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseWriteService } from "@/services/course-write-service";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let tempDir: string;
let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setupTempGitRepo = () => {
  tempDir = fs.mkdtempSync(path.join(tmpdir(), "course-write-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, ".gitkeep"), "");
  execSync("git add . && git commit -m 'init'", { cwd: tempDir });
};

const setup = async () => {
  setupTempGitRepo();
  await truncateAllTables(testDb);

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

  const testLayer = Layer.mergeAll(
    CourseWriteService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer), Layer.provide(NodeContext.layer));

  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const run = <A, E>(effect: Effect.Effect<A, E, CourseWriteService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)));

  const repo = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({
      filePath: tempDir,
      name: "test-repo",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: repo.id,
      name: "v1",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const createSection = async (sectionPath: string, order: number) => {
    const sectionDir = path.join(tempDir, sectionPath);
    fs.mkdirSync(sectionDir, { recursive: true });
    fs.writeFileSync(path.join(sectionDir, ".gitkeep"), "");
    execSync(`git add . && git commit -m 'add ${sectionPath}'`, {
      cwd: tempDir,
    });
    const sections = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionPath, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const createRealLesson = async (
    sectionId: string,
    sectionPath: string,
    lessonPath: string,
    order: number
  ) => {
    const explainerDir = path.join(
      tempDir,
      sectionPath,
      lessonPath,
      "explainer"
    );
    fs.mkdirSync(explainerDir, { recursive: true });
    fs.writeFileSync(path.join(explainerDir, "readme.md"), "# Test\n");
    execSync(`git add . && git commit -m 'add ${lessonPath}'`, {
      cwd: tempDir,
    });
    const lessons = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createLessons(sectionId, [
        { lessonPathWithNumber: lessonPath, lessonNumber: order },
      ]);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lessons[0]!;
  };

  const createGhostLesson = async (
    sectionId: string,
    title: string,
    slug: string,
    order: number
  ) => {
    const lesson = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createGhostLesson(sectionId, {
        title,
        path: slug,
        order,
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lesson[0]!;
  };

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createRealLesson,
    createGhostLesson,
    getLesson,
  };
};

describe("CourseWriteService", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("reorderLessons", () => {
    it("reorders real lessons: renames dirs on disk and updates DB paths and order", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second",
        2
      );
      const real3 = await createRealLesson(
        section.id,
        "01-intro",
        "01.03-third",
        3
      );

      // Reverse order: third, second, first
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real3.id,
            real2.id,
            real1.id,
          ]);
        })
      );

      // Filesystem: dirs renamed to match new order
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-third"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-first"))).toBe(
        true
      );

      // Old paths gone
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        false
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );

      // DB paths updated
      const updated1 = await getLesson(real1.id);
      expect(updated1.path).toBe("01.03-first");
      expect(updated1.order).toBe(2);

      const updated2 = await getLesson(real2.id);
      expect(updated2.path).toBe("01.02-second");
      expect(updated2.order).toBe(1);

      const updated3 = await getLesson(real3.id);
      expect(updated3.path).toBe("01.01-third");
      expect(updated3.order).toBe(0);
    });

    it("reorder with mixed ghost + real: only real lessons renamed on disk, all get updated order", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const ghost = await createGhostLesson(
        section.id,
        "Ghost Lesson",
        "ghost-lesson",
        2
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-third",
        3
      );

      // New order: real2, ghost, real1
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real2.id,
            ghost.id,
            real1.id,
          ]);
        })
      );

      // Real lessons swapped on disk
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-first"))).toBe(
        true
      );

      // DB paths updated for real lessons
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.02-first");
      expect(updatedReal1.order).toBe(2);

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.01-third");
      expect(updatedReal2.order).toBe(0);

      // Ghost lesson: no filesystem change, order updated
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("ghost-lesson"); // unchanged
      expect(updatedGhost.order).toBe(1);
    });

    it("no-op when order hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real1.id,
            real2.id,
          ]);
        })
      );

      expect(result.renames).toHaveLength(0);

      // Filesystem unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(true);

      // DB paths unchanged
      const updated1 = await getLesson(real1.id);
      expect(updated1.path).toBe("01.01-first");

      const updated2 = await getLesson(real2.id);
      expect(updated2.path).toBe("01.02-second");
    });
  });

  describe("reorderLessons (ghost-only section)", () => {
    it("reorders all-ghost lessons: all order values updated correctly", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "Alpha", "alpha", 0);
      const g2 = await createGhostLesson(section.id, "Beta", "beta", 1);
      const g3 = await createGhostLesson(section.id, "Gamma", "gamma", 2);
      const g4 = await createGhostLesson(section.id, "Delta", "delta", 3);

      // Reverse the order
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            g4.id,
            g3.id,
            g2.id,
            g1.id,
          ]);
        })
      );

      const updatedG1 = await getLesson(g1.id);
      expect(updatedG1.order).toBe(3);

      const updatedG2 = await getLesson(g2.id);
      expect(updatedG2.order).toBe(2);

      const updatedG3 = await getLesson(g3.id);
      expect(updatedG3.order).toBe(1);

      const updatedG4 = await getLesson(g4.id);
      expect(updatedG4.order).toBe(0);
    });

    it("reorders a single ghost lesson (batch with one element)", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "Only", "only", 5);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [g1.id]);
        })
      );

      const updated = await getLesson(g1.id);
      expect(updated.order).toBe(0);
    });
  });

  describe("addGhostLesson (adjacent insertion)", () => {
    it("inserts before the first ghost lesson and shifts others", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const g1 = await createGhostLesson(section.id, "First", "first", 0);
      const g2 = await createGhostLesson(section.id, "Second", "second", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "Zeroth", {
            adjacentLessonId: g1.id,
            position: "before",
          });
        })
      );

      // The new lesson should have the order of the first lesson (0)
      const newLesson = await getLesson(result.lessonId);
      expect(newLesson.order).toBe(0);

      // Existing lessons should have been shifted up
      const updatedG1 = await getLesson(g1.id);
      expect(updatedG1.order).toBe(1);

      const updatedG2 = await getLesson(g2.id);
      expect(updatedG2.order).toBe(2);
    });
  });

  describe("moveToSection", () => {
    it("moves a real lesson: directory moved, source renumbered, DB updated", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.02-second",
        2
      );
      const real3 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.03-third",
        3
      );
      // Target section has one existing lesson
      await createRealLesson(section2.id, "02-advanced", "02.01-existing", 1);

      // Move real2 from section1 to section2
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real2.id, section2.id);
        })
      );

      // Lesson directory moved to target section with correct numbering
      expect(
        fs.existsSync(path.join(tempDir, "02-advanced", "02.02-second"))
      ).toBe(true);
      // Old location gone
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(false);

      // Source section renumbered: third lesson closes the gap (01.03 → 01.02)
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );

      // DB: moved lesson updated
      const movedLesson = await getLesson(real2.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.path).toBe("02.02-second");

      // DB: source section renumbered
      const updatedReal3 = await getLesson(real3.id);
      expect(updatedReal3.path).toBe("01.02-third");

      // DB: first lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
    });

    it("moves a ghost lesson: DB-only update, no filesystem ops", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const ghost = await createGhostLesson(
        section1.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(ghost.id, section2.id);
        })
      );

      // DB: moved to target section
      const movedLesson = await getLesson(ghost.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.fsStatus).toBe("ghost");
      expect(movedLesson.path).toBe("ghost-lesson"); // path unchanged for ghost
    });

    it("moves a real lesson to an empty section", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-only-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real1.id, section2.id);
        })
      );

      // Source section reverts to ghost (last real lesson moved out),
      // so 02-advanced renumbers to 01-advanced, lesson path follows
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced", "01.01-only-lesson"))
      ).toBe(true);
      // Source section directory deleted
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);

      const movedLesson = await getLesson(real1.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.path).toBe("01.01-only-lesson");
    });
  });
});
