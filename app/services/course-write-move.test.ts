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

  describe("moveToSection", () => {
    it("moves a real lesson: directory moved, source renumbered, DB updated", async () => {
      const { createSection, createRealLesson, getLesson } = await setup();

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
      await ctx.run(
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
      const { createSection, createGhostLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const ghost = await createGhostLesson(
        section1.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      await ctx.run(
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

    it("materializes ghost target section when moving a real lesson into it", async () => {
      const {
        createSection,
        createGhostSection,
        createRealLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const ghostSection = await createGhostSection("Advanced Topics", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real1.id, ghostSection.id);
        })
      );

      // Ghost section should be materialized with a directory on disk.
      // Source section reverted to ghost (lost its only real lesson),
      // so renumbering shifts target from 02 → 01.
      const updatedSection = await getSection(ghostSection.id);
      expect(updatedSection.path).toBe("01-advanced-topics");
      expect(fs.existsSync(path.join(tempDir, "01-advanced-topics"))).toBe(
        true
      );

      // Lesson should be moved into the materialized section
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced-topics", "01.01-first"))
      ).toBe(true);

      const movedLesson = await getLesson(real1.id);
      expect(movedLesson.sectionId).toBe(ghostSection.id);
      expect(movedLesson.path).toBe("01.01-first");
    });

    it("materializes ghost target section keeping numbering when source stays real", async () => {
      const {
        createSection,
        createGhostSection,
        createRealLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const ghostSection = await createGhostSection("Advanced Topics", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );
      await createRealLesson(section1.id, "01-intro", "01.02-second", 2);

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real1.id, ghostSection.id);
        })
      );

      // Source still has a real lesson, so no revert — ghost materializes as 02
      const updatedSection = await getSection(ghostSection.id);
      expect(updatedSection.path).toBe("02-advanced-topics");
      expect(fs.existsSync(path.join(tempDir, "02-advanced-topics"))).toBe(
        true
      );

      expect(
        fs.existsSync(path.join(tempDir, "02-advanced-topics", "02.01-first"))
      ).toBe(true);

      const movedLesson = await getLesson(real1.id);
      expect(movedLesson.sectionId).toBe(ghostSection.id);
      expect(movedLesson.path).toBe("02.01-first");
    });

    it("materializes ghost target section even when its path is already numbered", async () => {
      const {
        createSection,
        createGhostSection,
        createRealLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      // A ghost section can carry a numbered path (e.g. left over after its
      // last real lesson moved out) while having no directory on disk. It is
      // still a ghost — real-ness is "has at least one real lesson", not "path
      // happens to parse as NN-slug".
      const ghostSection = await createGhostSection("02-concepts", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );
      // Keep a second real lesson so the source stays real and the target
      // ghost section keeps its 02 number.
      await createRealLesson(section1.id, "01-intro", "01.02-second", 2);

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real1.id, ghostSection.id);
        })
      );

      // The directory must be materialized on disk for the git mv to land.
      const updatedSection = await getSection(ghostSection.id);
      expect(fs.existsSync(path.join(tempDir, updatedSection.path))).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, updatedSection.path, "02.01-first"))
      ).toBe(true);

      const movedLesson = await getLesson(real1.id);
      expect(movedLesson.sectionId).toBe(ghostSection.id);
      expect(movedLesson.path).toBe("02.01-first");
    });

    it("moves a real lesson to an empty section", async () => {
      const { createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-only-lesson",
        1
      );

      await ctx.run(
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

  describe("moveLessonsToSection", () => {
    it("moves a multi-lesson selection into another section as a contiguous block", async () => {
      const { createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const a = await createRealLesson(section1.id, "01-intro", "01.01-a", 1);
      const b = await createRealLesson(section1.id, "01-intro", "01.02-b", 2);
      const c = await createRealLesson(section1.id, "01-intro", "01.03-c", 3);
      await createRealLesson(section2.id, "02-advanced", "02.01-existing", 1);

      // Move the non-contiguous selection {a, c} into section2.
      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveLessonsToSection([a.id, c.id], section2.id);
        })
      );

      // Both selected lessons landed in the target, numbered as a block after
      // the existing lesson, preserving their source order (a before c).
      expect(fs.existsSync(path.join(tempDir, "02-advanced", "02.02-a"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "02-advanced", "02.03-c"))).toBe(
        true
      );

      const movedA = await getLesson(a.id);
      const movedC = await getLesson(c.id);
      expect(movedA.sectionId).toBe(section2.id);
      expect(movedA.path).toBe("02.02-a");
      expect(movedC.sectionId).toBe(section2.id);
      expect(movedC.path).toBe("02.03-c");

      // The unselected source lesson stayed and renumbered to close the gap.
      const keptB = await getLesson(b.id);
      expect(keptB.sectionId).toBe(section1.id);
      expect(keptB.path).toBe("01.01-b");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-b"))).toBe(
        true
      );
    });

    it("dematerializes the source section when the move empties it", async () => {
      const { createSection, createRealLesson, getLesson, getSection } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const a = await createRealLesson(section1.id, "01-intro", "01.01-a", 1);
      const b = await createRealLesson(section1.id, "01-intro", "01.02-b", 2);
      await createRealLesson(section2.id, "02-advanced", "02.01-existing", 1);

      await ctx.run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveLessonsToSection([a.id, b.id], section2.id);
        })
      );

      // Source emptied → its directory is gone and section2 renumbers 02 → 01.
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      const target = await getSection(section2.id);
      expect(target.path).toBe("01-advanced");

      const movedA = await getLesson(a.id);
      const movedB = await getLesson(b.id);
      expect(movedA.sectionId).toBe(section2.id);
      expect(movedB.sectionId).toBe(section2.id);
    });
  });
});
