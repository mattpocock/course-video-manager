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

  describe("renameSection", () => {
    it("renames a section slug via git mv and updates DB path", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.path).toBe("01-introduction");

      // Old dir gone, new dir exists
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "01-introduction"))).toBe(true);

      // DB updated
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-introduction");
    });

    it("is a no-op when slug hasn't changed", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "intro");
        })
      );

      expect(result.path).toBe("01-intro");

      // Directory unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(true);

      // DB unchanged
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-intro");
    });

    it("renames section with real lessons: lesson dirs preserved inside renamed section", async () => {
      const { run, createSection, createRealLesson, getSection, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.path).toBe("01-introduction");

      // Section directory renamed
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "01-introduction"))).toBe(true);

      // Lesson directory preserved inside renamed section
      expect(
        fs.existsSync(
          path.join(tempDir, "01-introduction", "01.01-first-lesson")
        )
      ).toBe(true);

      // DB: section path updated
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-introduction");

      // DB: lesson path unchanged (section number didn't change)
      const updatedLesson = await getLesson(real1.id);
      expect(updatedLesson.path).toBe("01.01-first-lesson");
    });
  });

  describe("reorderSections", () => {
    it("section swap: directories renamed, nested lesson paths updated on disk and in DB", async () => {
      const { run, createSection, createRealLesson, getLesson, getSection } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      const lesson2 = await createRealLesson(
        section2.id,
        "02-advanced",
        "02.01-second-lesson",
        1
      );

      // Swap sections: advanced first, intro second
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Section directories swapped on disk
      expect(fs.existsSync(path.join(tempDir, "01-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);

      // Lesson directories within renamed sections updated
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced", "01.01-second-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-first-lesson"))
      ).toBe(true);

      // Old lesson paths gone
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced", "02.01-second-lesson"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "01.01-first-lesson"))
      ).toBe(false);

      // DB: section paths updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-advanced");
      expect(updatedSection2.order).toBe(0);

      // DB: lesson paths updated with new section number prefix
      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("02.01-first-lesson");

      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("01.01-second-lesson");
    });

    it("no-op when order hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson, getSection } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section1.id, section2.id]);
        })
      );

      // Filesystem unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );

      // DB unchanged
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-intro");

      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("01.01-first");
    });

    it("section with ghost lessons: only real lesson paths updated, ghosts unchanged", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-real-lesson",
        1
      );
      const ghost1 = await createGhostLesson(
        section1.id,
        "Ghost Lesson",
        "ghost-lesson",
        2
      );

      // Swap sections
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Section directories swapped
      expect(fs.existsSync(path.join(tempDir, "01-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);

      // Real lesson path updated
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-real-lesson"))
      ).toBe(true);

      // DB: real lesson path updated
      const updatedReal = await getLesson(real1.id);
      expect(updatedReal.path).toBe("02.01-real-lesson");

      // DB: ghost lesson path unchanged (no filesystem representation)
      const updatedGhost = await getLesson(ghost1.id);
      expect(updatedGhost.path).toBe("ghost-lesson");

      // DB: section paths and order updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-advanced");
      expect(updatedSection2.order).toBe(0);
    });

    it("ghost-only section reorder: skips git mv for ghost section, renames real sections", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Real section with a lesson on disk
      const section1 = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );

      // Ghost-only section (no directory on disk)
      const section2 = await createGhostSection("02-before-we-start", 2);
      const ghost = await createGhostLesson(
        section2.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      // Reorder: ghost section first, real section second
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Real section directory renamed on disk
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);

      // Real lesson path updated on disk
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-first-lesson"))
      ).toBe(true);

      // DB: section paths updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-before-we-start");
      expect(updatedSection2.order).toBe(0);

      // DB: real lesson path updated
      const updatedLesson = await getLesson(lesson1.id);
      expect(updatedLesson.path).toBe("02.01-first-lesson");

      // DB: ghost lesson path unchanged
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("ghost-lesson");
    });
  });
});
