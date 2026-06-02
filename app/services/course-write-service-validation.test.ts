/**
 * Tests that every filesystem-touching write runs pre-flight + post-write
 * validation (PRD #952), DB-only operations skip validation entirely,
 * and ghost-only edits in conditionally-FS operations pay nothing.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { createDirectCourseEditorService } from "./course-editor-service-handler";
import type { CourseEditorService } from "./course-editor-service";
import { DrizzleService } from "./drizzle-service.server";
import { CourseOperationsService } from "./db-course-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { CourseWriteService } from "./course-write-service";
import { CourseRepoWriteService } from "./course-repo-write-service";
import {
  CourseRepoSyncValidationService,
  CourseRepoSyncError,
} from "./course-repo-sync-validation";
import { NodeFileSystem } from "@effect/platform-node";
import * as schema from "@/db/schema";

let testDb: TestDb;
let editorService: CourseEditorService;
let validateCallCount: number;

function setup() {
  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);
    validateCallCount = 0;

    const testDrizzleLayer = Layer.succeed(DrizzleService, testDb as any);
    const testDbFunctionsLayer = Layer.mergeAll(
      CourseOperationsService.Default,
      LessonSectionOperationsService.Default
    ).pipe(Layer.provide(testDrizzleLayer));

    const mockRepoWriteLayer = Layer.succeed(CourseRepoWriteService, {
      createLessonDirectory: Effect.fn(function* (_opts: any) {
        return { lessonDirName: "mock", lessonNumber: 1 };
      }),
      addLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLessons: Effect.fn(function* (_opts: any) {}),
      renameSections: Effect.fn(function* (_opts: any) {}),
      deleteLesson: Effect.fn(function* (_opts: any) {}),
      moveLessonToSection: Effect.fn(function* (_opts: any) {}),
      sectionDirExists: Effect.fn(function* (_opts: any) {
        return false;
      }),
      deleteSectionDir: Effect.fn(function* (_opts: any) {}),
    } as any);

    // Counting mock: tracks how many times validate() is called
    const mockSyncValidationLayer = Layer.succeed(
      CourseRepoSyncValidationService,
      {
        validate: () =>
          Effect.sync(() => {
            validateCallCount++;
          }),
      } as any
    );

    const testLayer = Layer.mergeAll(
      testDbFunctionsLayer,
      mockRepoWriteLayer,
      mockSyncValidationLayer,
      NodeFileSystem.layer
    ).pipe(Layer.provideMerge(testDrizzleLayer));

    const serviceLayer = (
      CourseWriteService as any
    ).DefaultWithoutDependencies.pipe(Layer.provide(testLayer));

    const fullLayer = Layer.merge(testLayer, serviceLayer) as Layer.Layer<
      any,
      never,
      never
    >;

    const runtime = ManagedRuntime.make(fullLayer);
    editorService = createDirectCourseEditorService((effect) =>
      runtime.runPromise(effect as any)
    );
  });
}

const svc = () => editorService;
const db = () => testDb;

async function createCourseWithVersion(
  filePath: string | null = "/tmp/test-repo"
) {
  const [course] = await db()
    .insert(schema.courses)
    .values({ name: "Test Course", filePath })
    .returning();
  const [version] = await db()
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  return { course: course!, version: version! };
}

async function createSectionWithLessons(
  repoVersionId: string,
  sectionPath: string,
  sectionOrder: number,
  lessonDefs: {
    path: string;
    title: string;
    fsStatus: string;
    order: number;
  }[]
) {
  const [section] = await db()
    .insert(schema.sections)
    .values({ repoVersionId, path: sectionPath, order: sectionOrder })
    .returning();
  const lessons = [];
  for (const def of lessonDefs) {
    const [lesson] = await db()
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        ...def,
        authoringStatus: def.fsStatus === "real" ? "done" : null,
      })
      .returning();
    lessons.push(lesson!);
  }
  return { section: section!, lessons };
}

setup();

describe("sync validation optimization (Issue #685)", () => {
  describe("DB-only operations skip validation entirely", () => {
    it("moving a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );
      const { section: sectionB } = await createSectionWithLessons(
        version.id,
        "02-basics",
        1,
        []
      );

      validateCallCount = 0;
      await svc().moveLessonToSection(lessons[0]!.id, sectionB.id);
      expect(validateCallCount).toBe(0);
    });

    it("deleting a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );

      validateCallCount = 0;
      await svc().deleteLesson(lessons[0]!.id);
      expect(validateCallCount).toBe(0);
    });

    it("renaming a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "my-lesson", title: "My Lesson", fsStatus: "ghost", order: 0 }]
      );

      validateCallCount = 0;
      await svc().updateLessonName(lessons[0]!.id, "new-name");
      expect(validateCallCount).toBe(0);
    });

    it("adding a ghost section does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();

      validateCallCount = 0;
      await svc().createSection(version.id, "New Section", 0);
      expect(validateCallCount).toBe(0);
    });

    it("adding a ghost lesson does not trigger validation", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);

      validateCallCount = 0;
      await svc().addGhostLesson(s.sectionId, "New Lesson");
      expect(validateCallCount).toBe(0);
    });
  });

  describe("always-FS operations validate twice (pre + post)", () => {
    it("creating a real lesson validates twice", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const [section] = await db()
        .insert(schema.sections)
        .values({ repoVersionId: version.id, path: "01-intro", order: 0 })
        .returning();

      validateCallCount = 0;
      await svc().createRealLesson(section!.id, "New Lesson");
      expect(validateCallCount).toBe(2);
    });
  });

  describe("conditionally-FS operations validate twice (pre + post)", () => {
    it("deleting a real lesson validates twice", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      validateCallCount = 0;
      await svc().deleteLesson(lessons[0]!.id);
      expect(validateCallCount).toBe(2);
    });

    it("moving a real lesson validates twice", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );
      const { section: sectionB } = await createSectionWithLessons(
        version.id,
        "02-basics",
        1,
        []
      );

      validateCallCount = 0;
      await svc().moveLessonToSection(lessons[0]!.id, sectionB.id);
      expect(validateCallCount).toBe(2);
    });

    it("renaming a real lesson validates twice", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      validateCallCount = 0;
      await svc().updateLessonName(lessons[0]!.id, "new-name");
      expect(validateCallCount).toBe(2);
    });

    it("converting a real lesson to ghost validates twice", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      validateCallCount = 0;
      await svc().convertToGhost(lessons[0]!.id);
      expect(validateCallCount).toBe(2);
    });
  });
});

describe("pre-flight validation gate (PRD #952)", () => {
  let divergentDb: TestDb;
  let divergentEditorService: CourseEditorService;

  beforeAll(async () => {
    const result = await createTestDb();
    divergentDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(divergentDb);

    const testDrizzleLayer = Layer.succeed(DrizzleService, divergentDb as any);
    const testDbFunctionsLayer = Layer.mergeAll(
      CourseOperationsService.Default,
      LessonSectionOperationsService.Default
    ).pipe(Layer.provide(testDrizzleLayer));

    const mockRepoWriteLayer = Layer.succeed(CourseRepoWriteService, {
      createLessonDirectory: Effect.fn(function* (_opts: any) {
        return { lessonDirName: "mock", lessonNumber: 1 };
      }),
      addLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLesson: Effect.fn(function* (_opts: any) {
        return { newLessonDirName: "mock" };
      }),
      renameLessons: Effect.fn(function* (_opts: any) {}),
      renameSections: Effect.fn(function* (_opts: any) {}),
      deleteLesson: Effect.fn(function* (_opts: any) {}),
      moveLessonToSection: Effect.fn(function* (_opts: any) {}),
      sectionDirExists: Effect.fn(function* (_opts: any) {
        return false;
      }),
      deleteSectionDir: Effect.fn(function* (_opts: any) {}),
    } as any);

    const failingSyncValidationLayer = Layer.succeed(
      CourseRepoSyncValidationService,
      {
        validate: () =>
          Effect.fail(
            new CourseRepoSyncError({
              cause: null,
              message: "Divergent repo: missing directory 06-section",
            })
          ),
      } as any
    );

    const testLayer = Layer.mergeAll(
      testDbFunctionsLayer,
      mockRepoWriteLayer,
      failingSyncValidationLayer,
      NodeFileSystem.layer
    ).pipe(Layer.provideMerge(testDrizzleLayer));

    const serviceLayer = (
      CourseWriteService as any
    ).DefaultWithoutDependencies.pipe(Layer.provide(testLayer));

    const fullLayer = Layer.merge(testLayer, serviceLayer) as Layer.Layer<
      any,
      never,
      never
    >;

    const runtime = ManagedRuntime.make(fullLayer);
    divergentEditorService = createDirectCourseEditorService((effect) =>
      runtime.runPromise(effect as any)
    );
  });

  const dsvc = () => divergentEditorService;
  const ddb = () => divergentDb;

  async function createCourse(filePath: string | null = "/tmp/test-repo") {
    const [course] = await ddb()
      .insert(schema.courses)
      .values({ name: "Test Course", filePath })
      .returning();
    const [version] = await ddb()
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();
    return { course: course!, version: version! };
  }

  async function createSection(
    repoVersionId: string,
    path: string,
    order: number,
    lessonDefs: {
      path: string;
      title: string;
      fsStatus: string;
      order: number;
    }[] = []
  ) {
    const [section] = await ddb()
      .insert(schema.sections)
      .values({ repoVersionId, path, order })
      .returning();
    const lessons = [];
    for (const def of lessonDefs) {
      const [lesson] = await ddb()
        .insert(schema.lessons)
        .values({
          sectionId: section!.id,
          ...def,
          authoringStatus: def.fsStatus === "real" ? "done" : null,
        })
        .returning();
      lessons.push(lesson!);
    }
    return { section: section!, lessons };
  }

  describe("always-FS operations are refused on a divergent repo", () => {
    it("createRealLesson fails with CourseRepoSyncError before mutation", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { section } = await createSection(version.id, "01-intro", 0);

      await expect(
        dsvc().createRealLesson(section.id, "New Lesson")
      ).rejects.toThrow("Divergent repo");

      const lessons = await ddb().select().from(schema.lessons);
      expect(lessons).toHaveLength(0);
    });
  });

  describe("conditionally-FS operations are refused on a divergent repo", () => {
    it("deleteLesson fails with CourseRepoSyncError for a real lesson", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "01.01-my-lesson",
          title: "My Lesson",
          fsStatus: "real",
          order: 0,
        },
      ]);

      await expect(dsvc().deleteLesson(lessons[0]!.id)).rejects.toThrow(
        "Divergent repo"
      );

      const dbLessons = await ddb().select().from(schema.lessons);
      expect(dbLessons).toHaveLength(1);
    });

    it("deleteLesson succeeds for a ghost lesson on a divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "my-lesson",
          title: "My Lesson",
          fsStatus: "ghost",
          order: 0,
        },
      ]);

      const result = await dsvc().deleteLesson(lessons[0]!.id);
      expect(result.success).toBe(true);
    });

    it("renameLesson fails with CourseRepoSyncError for a real lesson", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "01.01-my-lesson",
          title: "My Lesson",
          fsStatus: "real",
          order: 0,
        },
      ]);

      await expect(
        dsvc().updateLessonName(lessons[0]!.id, "new-name")
      ).rejects.toThrow("Divergent repo");

      const dbLessons = await ddb().select().from(schema.lessons);
      expect(dbLessons[0]!.path).toBe("01.01-my-lesson");
    });

    it("renameLesson succeeds for a ghost lesson on a divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "my-lesson",
          title: "My Lesson",
          fsStatus: "ghost",
          order: 0,
        },
      ]);

      const result = await dsvc().updateLessonName(lessons[0]!.id, "new-name");
      expect(result.success).toBe(true);
    });

    it("moveToSection fails with CourseRepoSyncError when plan has fs ops", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "01.01-my-lesson",
          title: "My Lesson",
          fsStatus: "real",
          order: 0,
        },
      ]);
      const { section: sectionB } = await createSection(
        version.id,
        "02-basics",
        1
      );

      await expect(
        dsvc().moveLessonToSection(lessons[0]!.id, sectionB.id)
      ).rejects.toThrow("Divergent repo");

      const dbLessons = await ddb().select().from(schema.lessons);
      expect(dbLessons[0]!.sectionId).toBe(lessons[0]!.sectionId);
    });

    it("moveToSection succeeds for a ghost lesson on a divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "my-lesson",
          title: "My Lesson",
          fsStatus: "ghost",
          order: 0,
        },
      ]);
      const { section: sectionB } = await createSection(
        version.id,
        "02-basics",
        1
      );

      const result = await dsvc().moveLessonToSection(
        lessons[0]!.id,
        sectionB.id
      );
      expect(result.success).toBe(true);
    });

    it("convertToGhost fails with CourseRepoSyncError for a real lesson", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { lessons } = await createSection(version.id, "01-intro", 0, [
        {
          path: "01.01-my-lesson",
          title: "My Lesson",
          fsStatus: "real",
          order: 0,
        },
      ]);

      await expect(dsvc().convertToGhost(lessons[0]!.id)).rejects.toThrow(
        "Divergent repo"
      );

      const dbLessons = await ddb().select().from(schema.lessons);
      expect(dbLessons[0]!.fsStatus).toBe("real");
    });
  });

  describe("DB-only operations bypass the gate on a divergent repo", () => {
    it("addGhostSection succeeds despite divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");

      const result = await dsvc().createSection(version.id, "New Section", 0);
      expect(result.sectionId).toBeDefined();
    });

    it("addGhostLesson succeeds despite divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const s = await dsvc().createSection(version.id, "Section A", 0);

      const result = await dsvc().addGhostLesson(s.sectionId, "New Lesson");
      expect(result.lessonId).toBeDefined();
    });

    it("archiveSection succeeds despite divergent repo", async () => {
      const { version } = await createCourse("/tmp/test-repo");
      const { section } = await createSection(version.id, "01-intro", 0);

      const result = await dsvc().archiveSection(section.id);
      expect(result.success).toBe(true);
    });
  });
});
