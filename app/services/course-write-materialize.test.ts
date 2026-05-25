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

  const createGhostSection = async (sectionPath: string, order: number) => {
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

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    repoVersionId: version.id,
    createSection,
    createGhostSection,
    createRealLesson,
    createGhostLesson,
    getLesson,
    getSection,
  };
};

describe("CourseWriteService", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("materializeGhost", () => {
    it("ghost at the end: creates directory, no shifts needed", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first-lesson", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Second Lesson",
        "second-lesson",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      expect(result.path).toBe("01.02-second-lesson");

      // Verify directory was created
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-intro",
            "01.02-second-lesson",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);

      // Verify DB updated
      const updated = await getLesson(ghost.id);
      expect(updated.fsStatus).toBe("real");
      expect(updated.path).toBe("01.02-second-lesson");
    });

    it("ghost in the middle: creates directory AND shifts subsequent real lessons", async () => {
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
        "01.01-first-lesson",
        1
      );
      const ghost = await createGhostLesson(
        section.id,
        "Middle Lesson",
        "middle-lesson",
        2
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-third-lesson",
        3
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost (order=2) is between real1 (order=1) and real2 (order=3)
      // insertAtIndex = 1, new lesson = 01.02, real2 shifts 01.02 → 01.03
      expect(result.path).toBe("01.02-middle-lesson");

      // New directory created
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-middle-lesson"))
      ).toBe(true);

      // Shifted lesson directory renamed
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-third-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-third-lesson"))
      ).toBe(false);

      // DB: ghost is now real
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.fsStatus).toBe("real");
      expect(updatedGhost.path).toBe("01.02-middle-lesson");

      // DB: shifted lesson path updated
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-third-lesson");

      // DB: first real lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first-lesson");
    });

    it("ghost at the beginning: shifts all real lessons", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Before All",
        "before-all",
        0
      );
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second-lesson",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost (order=0) before all reals, insertAtIndex = 0
      // New = 01.01, real1 shifts 01.01 → 01.02, real2 shifts 01.02 → 01.03
      expect(result.path).toBe("01.01-before-all");

      // Verify directories
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-before-all"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-first-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-second-lesson"))
      ).toBe(true);

      // Old paths gone
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-first-lesson"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second-lesson"))
      ).toBe(false);

      // Verify DB
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("01.01-before-all");

      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.02-first-lesson");

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-second-lesson");
    });

    it("multiple ghosts interspersed: only real lessons are shifted", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);

      // Order: real1(1), ghost1(2), ghost2(3), real2(4)
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      await createGhostLesson(section.id, "Ghost One", "ghost-one", 2);
      const ghost2 = await createGhostLesson(
        section.id,
        "Ghost Two",
        "ghost-two",
        3
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-fourth",
        4
      );

      // Materialize ghost2 (order=3)
      // Real lessons: real1(order=1), real2(order=4)
      // insertAtIndex = 1 (real2 order=4 > ghost order=3)
      // New = 01.02, real2 shifts 01.02 → 01.03
      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost2.id);
        })
      );

      expect(result.path).toBe("01.02-ghost-two");

      // Verify filesystem
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-ghost-two"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-fourth"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-fourth"))
      ).toBe(false);

      // Verify DB
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-fourth");
    });

    it("rejects materializing a lesson that is already on disk", async () => {
      const { run, createSection, createRealLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-already-real",
        1
      );

      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.materializeGhost(real.id);
          })
        )
      ).rejects.toThrow();
    });
  });

  describe("addGhostLesson", () => {
    it("creates a ghost lesson appended at end of section", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "My New Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.lessonId).toBeDefined();

      const lesson = await getLesson(result.lessonId);
      expect(lesson.fsStatus).toBe("ghost");
      expect(lesson.title).toBe("My New Lesson");
      expect(lesson.path).toBe("my-new-lesson");
      expect(lesson.order).toBe(2);
    });

    it("creates first ghost lesson with order 1", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "First Lesson");
        })
      );

      const lesson = await getLesson(result.lessonId);
      expect(lesson.order).toBe(1);
    });
  });

  describe("materializeGhost renumbering", () => {
    it("materializing a ghost section in the middle renumbers other sections", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-basics",
        1
      );

      // Ghost section in the middle (order 2)
      const section2 = await createGhostSection("Middle Section", 2);

      const section3 = await createSection("02-advanced", 3);
      const lesson3 = await createRealLesson(
        section3.id,
        "02-advanced",
        "02.01-deep-dive",
        1
      );

      // Add and materialize ghost lesson → ghost section materializes
      const ghost = await createGhostLesson(section2.id, "Setup", "setup", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost section materialized at position 2
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("02-middle-section");

      // First section unchanged (already 01)
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-intro");

      // Third section renumbered: 02-advanced → 03-advanced
      const updatedSection3 = await getSection(section3.id);
      expect(updatedSection3.path).toBe("03-advanced");

      // Lesson in third section renumbered
      const updatedLesson3 = await getLesson(lesson3.id);
      expect(updatedLesson3.path).toBe("03.01-deep-dive");

      // Lesson in first section unchanged
      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("01.01-basics");

      // Verify filesystem
      expect(
        fs.existsSync(path.join(tempDir, "02-middle-section", "02.01-setup"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "03-advanced", "03.01-deep-dive"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);
    });

    it("materializing a ghost section at the start renumbers all other sections and lessons", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Ghost section at order 1 (first position)
      const section1 = await createGhostSection("Before We Start", 1);

      const section2 = await createSection("01-intro", 2);
      const lesson2 = await createRealLesson(
        section2.id,
        "01-intro",
        "01.01-basics",
        1
      );

      const section3 = await createSection("02-advanced", 3);
      const lesson3 = await createRealLesson(
        section3.id,
        "02-advanced",
        "02.01-deep-dive",
        1
      );

      // Add and materialize ghost lesson
      const ghost = await createGhostLesson(
        section1.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost section materialized at position 1
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-before-we-start");

      // Other sections renumbered
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("02-intro");

      const updatedSection3 = await getSection(section3.id);
      expect(updatedSection3.path).toBe("03-advanced");

      // Lessons renumbered
      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("02.01-basics");

      const updatedLesson3 = await getLesson(lesson3.id);
      expect(updatedLesson3.path).toBe("03.01-deep-dive");

      // Verify filesystem
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-were-going")
        )
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-basics"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "03-advanced", "03.01-deep-dive"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);
    });
  });
});
