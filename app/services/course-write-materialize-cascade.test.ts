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

let cascadeTempDir: string;
let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setupGhostCourse = async () => {
  cascadeTempDir = fs.mkdtempSync(path.join(tmpdir(), "course-cascade-test-"));
  execSync("git init", { cwd: cascadeTempDir });
  execSync('git config user.email "test@test.com"', { cwd: cascadeTempDir });
  execSync('git config user.name "Test"', { cwd: cascadeTempDir });
  fs.writeFileSync(path.join(cascadeTempDir, ".gitkeep"), "");
  execSync("git add . && git commit -m 'init'", { cwd: cascadeTempDir });

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

  const ghostCourse = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createGhostCourse({ name: "ghost-course" });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: ghostCourse.id,
      name: "v1",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

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

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const getCourse = (courseId: string) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      return yield* courseOps.getCourseById(courseId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    ghostCourse,
    repoVersionId: version.id,
    createGhostSection,
    createGhostLesson,
    getLesson,
    getSection,
    getCourse,
  };
};

describe("Materialization Cascade", () => {
  afterEach(() => {
    if (cascadeTempDir) {
      fs.rmSync(cascadeTempDir, { recursive: true, force: true });
    }
  });

  it("materializing a lesson in a ghost course assigns file path and creates directory", async () => {
    const { run, ghostCourse, createGhostSection, getLesson, getCourse } =
      await setupGhostCourse();

    const section = await createGhostSection("Introduction", 1);

    const result = await run(
      Effect.gen(function* () {
        const service = yield* CourseWriteService;
        return yield* service.materializeCourseWithLesson(
          section.id,
          "Getting Started",
          cascadeTempDir
        );
      })
    );

    expect(result.success).toBe(true);

    const updatedCourse = await getCourse(ghostCourse.id);
    expect(updatedCourse.filePath).toBe(cascadeTempDir);

    const lesson = await getLesson(result.lessonId);
    expect(lesson.fsStatus).toBe("real");
    expect(
      fs.existsSync(
        path.join(
          cascadeTempDir,
          "01-introduction",
          lesson.path,
          "explainer",
          "readme.md"
        )
      )
    ).toBe(true);
  });

  it("cascade materializes ghost section with correct numbering", async () => {
    const {
      run,
      createGhostSection,
      createGhostLesson,
      getSection,
      getLesson,
    } = await setupGhostCourse();

    const section1 = await createGhostSection("First Section", 1);
    const section2 = await createGhostSection("Second Section", 2);
    await createGhostLesson(section1.id, "Lesson A", "lesson-a", 1);

    const result = await run(
      Effect.gen(function* () {
        const service = yield* CourseWriteService;
        return yield* service.materializeCourseWithLesson(
          section2.id,
          "Lesson B",
          cascadeTempDir
        );
      })
    );

    expect(result.success).toBe(true);

    const updatedSection2 = await getSection(section2.id);
    expect(updatedSection2.path).toBe("01-second-section");

    const lesson = await getLesson(result.lessonId);
    expect(lesson.fsStatus).toBe("real");

    expect(fs.existsSync(path.join(cascadeTempDir, "01-second-section"))).toBe(
      true
    );
  });

  it("errors when file path does not exist", async () => {
    const { run, createGhostSection } = await setupGhostCourse();

    const section = await createGhostSection("Introduction", 1);

    await expect(
      run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeCourseWithLesson(
            section.id,
            "Some Lesson",
            "/nonexistent/path/that/does/not/exist"
          );
        })
      )
    ).rejects.toThrow("File path does not exist");
  });

  it("errors when directory is not a git repository", async () => {
    const { run, ghostCourse, createGhostSection, getCourse } =
      await setupGhostCourse();

    const nonGitDir = fs.mkdtempSync(
      path.join(tmpdir(), "course-non-git-test-")
    );

    const section = await createGhostSection("Introduction", 1);

    await expect(
      run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeCourseWithLesson(
            section.id,
            "Some Lesson",
            nonGitDir
          );
        })
      )
    ).rejects.toThrow("Directory is not a git repository");

    const course = await getCourse(ghostCourse.id);
    expect(course.filePath).toBeNull();

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("rolls back DB and filesystem when git add fails during cascade", async () => {
    const { run, ghostCourse, createGhostSection, getCourse, getSection } =
      await setupGhostCourse();

    const section = await createGhostSection("Introduction", 1);

    const fragileDir = fs.mkdtempSync(
      path.join(tmpdir(), "course-fragile-test-")
    );
    execSync("git init", { cwd: fragileDir });
    execSync('git config user.email "test@test.com"', { cwd: fragileDir });
    execSync('git config user.name "Test"', { cwd: fragileDir });
    fs.writeFileSync(path.join(fragileDir, ".gitkeep"), "");
    execSync("git add . && git commit -m 'init'", { cwd: fragileDir });
    fs.chmodSync(path.join(fragileDir, ".git", "objects"), 0o444);

    try {
      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.materializeCourseWithLesson(
              section.id,
              "Some Lesson",
              fragileDir
            );
          })
        )
      ).rejects.toThrow();

      const course = await getCourse(ghostCourse.id);
      expect(course.filePath).toBeNull();

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("Introduction");

      const entries = fs.readdirSync(fragileDir);
      expect(entries.filter((e) => e !== ".gitkeep" && e !== ".git")).toEqual(
        []
      );
    } finally {
      fs.chmodSync(path.join(fragileDir, ".git", "objects"), 0o755);
      fs.rmSync(fragileDir, { recursive: true, force: true });
    }
  });

  it("course stays real after all lessons are deleted", async () => {
    const { run, ghostCourse, createGhostSection, getCourse } =
      await setupGhostCourse();

    const section = await createGhostSection("Introduction", 1);

    const result = await run(
      Effect.gen(function* () {
        const service = yield* CourseWriteService;
        return yield* service.materializeCourseWithLesson(
          section.id,
          "Getting Started",
          cascadeTempDir
        );
      })
    );

    await run(
      Effect.gen(function* () {
        const service = yield* CourseWriteService;
        return yield* service.deleteLesson(result.lessonId);
      })
    );

    const updatedCourse = await getCourse(ghostCourse.id);
    expect(updatedCourse.filePath).toBe(cascadeTempDir);
  });
});
