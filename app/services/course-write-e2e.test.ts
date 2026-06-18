import { describe, it, expect, afterEach } from "vitest";
import { Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest({
  services: [
    CourseWriteService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
  ],
  extraProvide: [NodeContext.layer],
});

let tempDir: string;

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

  const repo = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({
      filePath: tempDir,
      name: "test-repo",
    });
  }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: repo.id,
      name: "v1",
    });
  }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

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
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);
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
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);
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
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);
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
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);
    return sections[0]!;
  };

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

  return {
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

  describe("end-to-end: create section → add ghost → materialize → rename", () => {
    it("full flow with slugified section path works without errors", async () => {
      const { createSection, getLesson } = await setup();

      const section = await createSection("01-before-we-start", 1);

      // Add ghost lesson
      const ghostResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "Where Were Going");
        })
      );
      expect(ghostResult.success).toBe(true);

      // Materialize ghost — files are auto-staged by createLessonDirectory
      const materializeResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghostResult.lessonId);
        })
      );
      expect(materializeResult.path).toBe("01.01-where-were-going");

      // Rename lesson — works without manual git commit because files are staged
      const renameResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(
            ghostResult.lessonId,
            "where-we-are-going"
          );
        })
      );
      expect(renameResult.path).toBe("01.01-where-we-are-going");

      // Verify final state on disk
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-we-are-going")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-were-going")
        )
      ).toBe(false);

      // Verify DB state
      const updatedLesson = await getLesson(ghostResult.lessonId);
      expect(updatedLesson.path).toBe("01.01-where-we-are-going");
      expect(updatedLesson.fsStatus).toBe("real");
    });

    it("reorder ghost section first → materialize → rename works", async () => {
      const {
        createSection,
        createGhostSection,
        createRealLesson,
        getLesson,
        getSection,
      } = await setup();

      // Existing real section
      const section1 = await createSection("01-intro", 1);
      await createRealLesson(section1.id, "01-intro", "01.01-basics", 1);

      // New ghost-only section (no directory on disk)
      const section2 = await createGhostSection("02-before-we-start", 2);

      // Add ghost lesson to the ghost section
      const ghostResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section2.id, "Where Were Going");
        })
      );

      // Reorder: ghost section first
      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Reordering does not renumber a ghost section (no real lessons, not on
      // disk) — its path is left untouched until it is materialized below.
      const reorderedSection2 = await getSection(section2.id);
      expect(reorderedSection2.path).toBe("02-before-we-start");

      // Materialize ghost lesson in the reordered section
      const materializeResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghostResult.lessonId);
        })
      );
      expect(materializeResult.path).toBe("01.01-where-were-going");

      // Verify directory created at correct path
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-before-we-start",
            "01.01-where-were-going",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);

      // Rename lesson — works without manual commit
      const renameResult = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(
            ghostResult.lessonId,
            "where-we-are-going"
          );
        })
      );
      expect(renameResult.path).toBe("01.01-where-we-are-going");

      // Verify final state
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-we-are-going")
        )
      ).toBe(true);

      const updatedLesson = await getLesson(ghostResult.lessonId);
      expect(updatedLesson.path).toBe("01.01-where-we-are-going");
      expect(updatedLesson.fsStatus).toBe("real");
    });
  });

  describe("ghost section lifecycle", () => {
    it("materializing a ghost lesson in a ghost section slugifies the section path and creates the directory", async () => {
      const { createGhostSection, createGhostLesson, getSection } =
        await setup();

      const section = await createGhostSection("Before We Start", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-before-we-start");

      // Verify section directory was created on disk
      expect(fs.existsSync(path.join(tempDir, "01-before-we-start"))).toBe(
        true
      );

      // Verify lesson directory was created inside the slugified section
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-before-we-start",
            "01.01-where-were-going",
            "explainer"
          )
        )
      ).toBe(true);
    });

    it("materializing a ghost lesson in an already-real section does not change the section path", async () => {
      const { createSection, createRealLesson, createGhostLesson, getSection } =
        await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first-lesson", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Second Lesson",
        "second-lesson",
        2
      );

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-intro");
    });

    it("converting the last real lesson to ghost reverts section path to title case", async () => {
      const { createGhostSection, createGhostLesson, getSection } =
        await setup();

      const section = await createGhostSection("Before We Start", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      // Materialize the ghost lesson (which also materializes the section)
      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const realSection = await getSection(section.id);
      expect(realSection.path).toBe("01-before-we-start");

      // Convert the lesson back to ghost
      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(ghost.id);
        })
      );

      const ghostSection = await getSection(section.id);
      expect(ghostSection.path).toBe("Before We Start");
    });

    it("addGhostSection creates a section with the raw title as its path", async () => {
      const { repoVersionId, getSection } = await setup();

      const result = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostSection(
            repoVersionId,
            "Before We Start"
          );
        })
      );

      expect(result.success).toBe(true);
      const section = await getSection(result.sectionId);
      expect(section.path).toBe("Before We Start");
    });

    it("converting a real lesson when other real lessons remain does not change the section path", async () => {
      const { createSection, createRealLesson, getSection } = await setup();

      const section = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      await createRealLesson(section.id, "01-intro", "01.02-second-lesson", 2);

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(lesson1.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-intro");
    });

    it("rejects operations when repo is out of sync with filesystem", async () => {
      const { createSection, createRealLesson } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-basics", 1);

      // Delete the section directory from disk to create a mismatch
      fs.rmSync(path.join(tempDir, "01-intro"), {
        recursive: true,
        force: true,
      });
      execSync("git add . && git commit -m 'remove section'", {
        cwd: tempDir,
      });

      // Attempting a rename should fail — either the operation itself fails
      // (CourseRepoWriteError from git mv) or post-validation catches the
      // mismatch (CourseRepoSyncError). Both are valid rejection paths.
      const result = await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "new-name");
        }).pipe(
          Effect.map(() => "succeeded" as const),
          Effect.catchTag("CourseRepoSyncError", () =>
            Effect.succeed("rejected" as const)
          ),
          Effect.catchTag("CourseRepoWriteError", () =>
            Effect.succeed("rejected" as const)
          )
        )
      );

      expect(result).toBe("rejected");
    });

    it("succeeds when latest version is in sync despite stale older versions", async () => {
      setupTempGitRepo();

      const repo = await Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.createCourse({
          filePath: tempDir,
          name: "test-repo",
        });
      }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

      const currentVersion = await Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        const lsOps = yield* LessonSectionOperationsService;
        const stale = yield* versionOps.createCourseVersion({
          repoId: repo.id,
          name: "v1-stale",
        });
        yield* lsOps.createSections({
          repoVersionId: stale.id,
          sections: [
            { sectionPathWithNumber: "01-old-name", sectionNumber: 1 },
          ],
        });
        return yield* versionOps.createCourseVersion({
          repoId: repo.id,
          name: "v2-current",
        });
      }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

      const sectionDir = path.join(tempDir, "01-intro");
      fs.mkdirSync(sectionDir, { recursive: true });
      const lessonDir = path.join(sectionDir, "01.01-basics", "explainer");
      fs.mkdirSync(lessonDir, { recursive: true });
      fs.writeFileSync(path.join(lessonDir, "readme.md"), "# Test\n");
      execSync("git add . && git commit -m 'add section'", {
        cwd: tempDir,
      });

      const [section] = await Effect.gen(function* () {
        const lsOps = yield* LessonSectionOperationsService;
        const sections = yield* lsOps.createSections({
          repoVersionId: currentVersion.id,
          sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
        });
        yield* lsOps.createLessons(sections[0]!.id, [
          { lessonPathWithNumber: "01.01-basics", lessonNumber: 1 },
        ]);
        return sections;
      }).pipe(Effect.provide(ctx.testLayer), Effect.runPromise);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section!.id, "getting-started");
        }).pipe(Effect.provide(ctx.testLayer))
      );

      expect(result.success).toBe(true);
    });

    it("dematerializing a section renumbers remaining real sections and their lessons", async () => {
      const {
        createGhostSection,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Ghost section → materialize → then dematerialize
      const section1 = await createGhostSection("Before We Start", 1);
      const section2 = await createSection("02-intro", 2);
      const lesson2 = await createRealLesson(
        section2.id,
        "02-intro",
        "02.01-basics",
        1
      );

      // Materialize ghost section by adding and materializing a lesson
      const ghost = await createGhostLesson(
        section1.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // After materialize: 01-before-we-start, 02-intro
      const materializedSection = await getSection(section1.id);
      expect(materializedSection.path).toBe("01-before-we-start");

      // Convert the lesson back to ghost → section dematerializes
      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(ghost.id);
        })
      );

      // Section reverted to ghost
      const ghostSection = await getSection(section1.id);
      expect(ghostSection.path).toBe("Before We Start");

      // Other section renumbered: 02-intro → 01-intro
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-intro");

      // Lesson within renumbered section also updated
      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("01.01-basics");

      // Verify filesystem
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-basics"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(false);
    });
  });
});
