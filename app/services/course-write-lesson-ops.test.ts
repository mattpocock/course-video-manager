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

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createRealLesson,
    createGhostLesson,
    getLesson,
    getSection,
    version,
  };
};

describe("CourseWriteService", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("deleteLesson", () => {
    it("deletes a real lesson from disk and database", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-to-delete",
        1
      );

      // Verify directory exists before
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-to-delete"))
      ).toBe(true);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(real.id);
        })
      );

      // Directory removed from disk
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-to-delete"))
      ).toBe(false);

      // Record removed from DB
      await expect(getLesson(real.id)).rejects.toThrow();
    });

    it("deletes a real lesson and renumbers remaining lessons", async () => {
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

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(real2.id);
        })
      );

      // Deleted lesson removed from disk
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(false);

      // Deleted lesson removed from DB
      await expect(getLesson(real2.id)).rejects.toThrow();

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );

      // Third lesson renumbered: 01.03 → 01.02
      const updatedReal3 = await getLesson(real3.id);
      expect(updatedReal3.path).toBe("01.02-third");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );
    });

    it("reverts section to ghost path when last real lesson is deleted", async () => {
      const { run, createSection, createRealLesson, getSection } =
        await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-only-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(real.id);
        })
      );

      // Directory removed from disk
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-only-lesson"))
      ).toBe(false);

      // Section path reverted to title case (no longer numbered)
      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("Intro");
    });

    it("deletes a ghost lesson from database only (no filesystem ops)", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(ghost.id);
        })
      );

      // Record removed from DB
      await expect(getLesson(ghost.id)).rejects.toThrow();
    });
  });

  describe("convertToGhost", () => {
    it("converts a real lesson in the middle: deletes dir and renumbers remaining", async () => {
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

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(real2.id);
        })
      );

      // Converted lesson is now ghost
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.fsStatus).toBe("ghost");

      // Directory removed
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(false);

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );

      // Third lesson renumbered to close gap: 01.03 → 01.02
      const updatedReal3 = await getLesson(real3.id);
      expect(updatedReal3.path).toBe("01.02-third");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );
    });

    it("converts a real lesson at the end: deletes dir, no renumbering needed", async () => {
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
        "01.02-last",
        2
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(real2.id);
        })
      );

      // Converted lesson is ghost
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.fsStatus).toBe("ghost");

      // Directory removed
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-last"))).toBe(
        false
      );

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
    });

    it("rejects converting a lesson that is already a ghost", async () => {
      const { run, createSection, createGhostLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(section.id, "Ghost", "ghost", 1);

      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.convertToGhost(ghost.id);
          })
        )
      ).rejects.toThrow();
    });
  });

  describe("renameLesson", () => {
    it("renames a real lesson slug via git mv and updates DB path", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-old-slug",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(real.id, "new-slug");
        })
      );

      expect(result.path).toBe("01.01-new-slug");

      // Old dir gone, new dir exists
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-old-slug"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-new-slug"))
      ).toBe(true);

      // DB updated
      const updated = await getLesson(real.id);
      expect(updated.path).toBe("01.01-new-slug");
    });

    it("is a no-op when slug hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-same-slug",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(real.id, "same-slug");
        })
      );

      expect(result.path).toBe("01.01-same-slug");

      // Directory unchanged
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-same-slug"))
      ).toBe(true);

      // DB unchanged
      const updated = await getLesson(real.id);
      expect(updated.path).toBe("01.01-same-slug");
    });

    it("renames a ghost lesson (DB only, no filesystem ops)", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Old Title",
        "old-title",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(ghost.id, "new-title");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("new-title");

      // DB updated
      const updated = await getLesson(ghost.id);
      expect(updated.path).toBe("new-title");
    });
  });

  describe("createRealLesson", () => {
    it("creates a real lesson on disk and in DB in one step", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createRealLesson(section.id, "My First Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("01.01-my-first-lesson");

      // Directory exists on disk
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-intro",
            "01.01-my-first-lesson",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);

      // DB entry is real
      const lesson = await getLesson(result.lessonId);
      expect(lesson.fsStatus).toBe("real");
      expect(lesson.path).toBe("01.01-my-first-lesson");
      expect(lesson.title).toBe("My First Lesson");
    });

    it("creates a real lesson with correct numbering between existing lessons", async () => {
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

      // Insert before second lesson
      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createRealLesson(
            section.id,
            "Inserted Lesson",
            { adjacentLessonId: real2.id, position: "before" }
          );
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("01.02-inserted-lesson");

      // New lesson dir exists
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-inserted-lesson"))
      ).toBe(true);

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");

      // Second lesson renumbered: 01.02 → 01.03
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-second");
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-second"))
      ).toBe(true);
    });

    it("errors when creating a real lesson in a ghost course", async () => {
      const { run } = await setup();

      // Create a ghost course (no filePath)
      const ghostCourse = await Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.createGhostCourse({ name: "ghost-course" });
      }).pipe(
        Effect.provide(
          CourseOperationsService.Default.pipe(
            Layer.provide(Layer.succeed(DrizzleService, testDb as any))
          )
        ),
        Effect.runPromise
      );

      const ghostVersion = await Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.createCourseVersion({
          repoId: ghostCourse.id,
          name: "v1",
        });
      }).pipe(
        Effect.provide(
          VersionOperationsService.Default.pipe(
            Layer.provide(Layer.succeed(DrizzleService, testDb as any))
          )
        ),
        Effect.runPromise
      );

      const ghostSection = await Effect.gen(function* () {
        const lsOps = yield* LessonSectionOperationsService;
        const sections = yield* lsOps.createSections({
          repoVersionId: ghostVersion.id,
          sections: [{ sectionPathWithNumber: "Planning", sectionNumber: 1 }],
        });
        return sections[0]!;
      }).pipe(
        Effect.provide(
          LessonSectionOperationsService.Default.pipe(
            Layer.provide(Layer.succeed(DrizzleService, testDb as any))
          )
        ),
        Effect.runPromise
      );

      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.createRealLesson(
              ghostSection.id,
              "Some Lesson"
            );
          })
        )
      ).rejects.toThrow();
    });
  });
});
