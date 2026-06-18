import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest(CourseOperationsService.Default);

async function createFullCourseStructure() {
  const [course] = await ctx.db
    .insert(schema.courses)
    .values({
      name: "Original Course",
      filePath: "/tmp/original",
      memory: "Some course notes",
    })
    .returning();

  const [version] = await ctx.db
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  // Two sections: one active, one archived
  const [activeSection] = await ctx.db
    .insert(schema.sections)
    .values({
      repoVersionId: version!.id,
      path: "01-intro",
      order: 1,
      description: "Introduction section",
    })
    .returning();

  await ctx.db.insert(schema.sections).values({
    repoVersionId: version!.id,
    path: "02-archived",
    order: 2,
    archivedAt: new Date(),
  });

  const [lesson] = await ctx.db
    .insert(schema.lessons)
    .values({
      sectionId: activeSection!.id,
      path: "01-intro/01-lesson",
      order: 1,
      fsStatus: "real",
      title: "First Lesson",
      icon: "code",
      priority: 3,
      previousVersionLessonId: "some-old-lesson-id",
      authoringStatus: "done",
    })
    .returning();

  // Set previousVersionSectionId on the active section
  await ctx.db
    .update(schema.sections)
    .set({ previousVersionSectionId: "some-old-section-id" })
    .where(eq(schema.sections.id, activeSection!.id));

  const [video] = await ctx.db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      path: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();

  // Clips: one active, one archived
  await ctx.db.insert(schema.clips).values([
    {
      videoId: video!.id,
      videoFilename: "clip-01.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a",
      text: "Hello world",
      beatType: "intro",
    },
    {
      videoId: video!.id,
      videoFilename: "clip-02.mp4",
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "b",
      archived: true,
      text: "Archived clip",
      beatType: "none",
    },
  ]);

  // Chapters: one active, one archived
  await ctx.db.insert(schema.chapters).values([
    {
      videoId: video!.id,
      name: "Section A",
      order: "a",
    },
    {
      videoId: video!.id,
      name: "Archived Section",
      order: "b",
      archived: true,
    },
  ]);

  // Thumbnails
  await ctx.db.insert(schema.thumbnails).values({
    videoId: video!.id,
    layers: JSON.stringify([{ type: "text", content: "thumb" }]),
    filePath: "/thumbs/01.png",
    selectedForUpload: true,
  });

  // Archived video
  await ctx.db.insert(schema.videos).values({
    lessonId: lesson!.id,
    path: "video-archived.mp4",
    originalFootagePath: "/footage/archived.mp4",
    archived: true,
  });

  return {
    course: course!,
    version: version!,
    activeSection: activeSection!,
    lesson: lesson!,
    video: video!,
  };
}

describe("duplicateCourse", () => {
  it("creates a new course with the provided name and filePath", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Duplicated Course",
          filePath: "/tmp/duplicated",
        });
      })
    );

    expect(result.course.name).toBe("Duplicated Course");
    expect(result.course.filePath).toBe("/tmp/duplicated");
  });

  it("copies the original course's memory field", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    expect(result.course.memory).toBe("Some course notes");
  });

  it("creates exactly one draft version", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const versions = await ctx.db.query.courseVersions.findMany({
      where: (v, { eq }) => eq(v.repoId, result.course.id),
    });

    expect(versions).toHaveLength(1);
    expect(versions[0]!.name).toBe("v1.0");
  });

  it("deep-copies sections with correct data and nulls previousVersionSectionId", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      orderBy: (s, { asc }) => asc(s.order),
    });

    // Only non-archived section copied
    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.path).toBe("01-intro");
    expect(newSections[0]!.description).toBe("Introduction section");
    expect(newSections[0]!.order).toBe(1);
    expect(newSections[0]!.previousVersionSectionId).toBeNull();
  });

  it("deep-copies lessons with correct data and nulls previousVersionLessonId", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    const lessons = newSections[0]!.lessons;
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.title).toBe("First Lesson");
    expect(lessons[0]!.icon).toBe("code");
    expect(lessons[0]!.fsStatus).toBe("real");
    expect(lessons[0]!.priority).toBe(3);
    expect(lessons[0]!.previousVersionLessonId).toBeNull();
  });

  it("excludes archived sections from the copy", async () => {
    const { course, version } = await createFullCourseStructure();

    // Verify source has 2 sections (1 active + 1 archived)
    const sourceSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, version.id),
    });
    expect(sourceSections).toHaveLength(2);

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.path).toBe("01-intro");
  });

  it("copies videos and excludes archived videos", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: true,
          },
        },
      },
    });

    const videos = newSections[0]!.lessons[0]!.videos;
    // Only non-archived video copied
    expect(videos).toHaveLength(1);
    expect(videos[0]!.path).toBe("video-01.mp4");
    expect(videos[0]!.originalFootagePath).toBe("/footage/raw-01.mp4");
  });

  it("copies clips and excludes archived clips", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: {
              with: {
                clips: {
                  orderBy: (c, { asc }) => asc(c.order),
                },
              },
            },
          },
        },
      },
    });

    const clips = newSections[0]!.lessons[0]!.videos[0]!.clips;
    // Only non-archived clip
    expect(clips).toHaveLength(1);
    expect(clips[0]!.text).toBe("Hello world");
    expect(clips[0]!.videoFilename).toBe("clip-01.mp4");
    expect(clips[0]!.beatType).toBe("intro");
  });

  it("copies chapters and excludes archived chapters", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: {
              with: {
                chapters: {
                  orderBy: (cs, { asc }) => asc(cs.order),
                },
              },
            },
          },
        },
      },
    });

    const chapters = newSections[0]!.lessons[0]!.videos[0]!.chapters;
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.name).toBe("Section A");
  });

  it("copies thumbnails", async () => {
    const { course } = await createFullCourseStructure();

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: {
              with: {
                thumbnails: true,
              },
            },
          },
        },
      },
    });

    const thumbnails = newSections[0]!.lessons[0]!.videos[0]!.thumbnails;
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]!.filePath).toBe("/thumbs/01.png");
    expect(thumbnails[0]!.selectedForUpload).toBe(true);
  });

  it("preserves entity ordering across sections and lessons", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Order Test", filePath: "/tmp/order" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    // Create sections in reverse order values to verify ordering
    await ctx.db.insert(schema.sections).values([
      { repoVersionId: version!.id, path: "01-first", order: 1 },
      { repoVersionId: version!.id, path: "02-second", order: 2 },
      { repoVersionId: version!.id, path: "03-third", order: 3 },
    ]);

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(newSections).toHaveLength(3);
    expect(newSections[0]!.path).toBe("01-first");
    expect(newSections[0]!.order).toBe(1);
    expect(newSections[1]!.path).toBe("02-second");
    expect(newSections[1]!.order).toBe(2);
    expect(newSections[2]!.path).toBe("03-third");
    expect(newSections[2]!.order).toBe(3);
  });

  it("fails with NotFoundError for non-existent source course", async () => {
    await expect(
      ctx.run(
        Effect.gen(function* () {
          const courseOps = yield* CourseOperationsService;
          return yield* courseOps.duplicateCourse({
            sourceCourseId: "non-existent-id",
            name: "Dup",
            filePath: "/tmp/dup",
          });
        })
      )
    ).rejects.toThrow();
  });

  it("fails with NotFoundError when source course has no versions", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "No Versions", filePath: "/tmp/no-versions" })
      .returning();

    await expect(
      ctx.run(
        Effect.gen(function* () {
          const courseOps = yield* CourseOperationsService;
          return yield* courseOps.duplicateCourse({
            sourceCourseId: course!.id,
            name: "Dup",
            filePath: "/tmp/dup",
          });
        })
      )
    ).rejects.toThrow();
  });

  it("handles course with sections but no lessons", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Empty Sections", filePath: "/tmp/empty" })
      .returning();

    const [version] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await ctx.db.insert(schema.sections).values({
      repoVersionId: version!.id,
      path: "01-empty",
      order: 1,
    });

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.path).toBe("01-empty");
    expect(newSections[0]!.lessons).toHaveLength(0);
  });

  it("copies null memory field", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "No Memory", filePath: "/tmp/no-memory" })
      .returning();

    await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" });

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    expect(result.course.memory).toBe("");
  });

  it("uses the latest version when multiple versions exist", async () => {
    const [course] = await ctx.db
      .insert(schema.courses)
      .values({ name: "Multi Version", filePath: "/tmp/multi" })
      .returning();

    const [oldVersion] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await ctx.db.insert(schema.sections).values({
      repoVersionId: oldVersion!.id,
      path: "01-old-section",
      order: 1,
    });

    const [newVersion] = await ctx.db
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v2" })
      .returning();

    await ctx.db.insert(schema.sections).values({
      repoVersionId: newVersion!.id,
      path: "01-new-section",
      order: 1,
    });

    const result = await ctx.run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
          filePath: "/tmp/dup",
        });
      })
    );

    const newSections = await ctx.db.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.path).toBe("01-new-section");
  });
});
