import * as schema from "@/db/schema";
import type { TestDb } from "@/test-utils/pglite";

export interface IntegrationSeed {
  courseAId: string;
  courseBArchivedId: string;
  draftVersionId: string;
  publishedVersionId: string;
  draftSectionId: string;
  oldSectionId: string;
  lessonId: string;
  lessonVideoId: string;
  clip1Id: string;
  clip2Id: string;
  archivedClipId: string;
  archivedLessonId: string;
  archivedSectionId: string;
  archivedLessonVideoId: string;
  standaloneActiveId: string;
  standaloneArchivedId: string;
  pitchActiveId: string;
  pitchArchivedId: string;
}

export const seedIntegration = async (db: TestDb): Promise<IntegrationSeed> => {
  const [courseA] = await db
    .insert(schema.courses)
    .values({ name: "Alpha", slug: "alpha" })
    .returning();
  const [courseB] = await db
    .insert(schema.courses)
    .values({
      name: "Beta",
      slug: "beta",
      archived: true,
    })
    .returning();

  const [publishedVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: courseA!.id,
      name: "v1.0.0",
      description: "first publish",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    })
    .returning();
  const [draftVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: courseA!.id,
      name: "",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();

  const [oldSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: publishedVersion!.id, title: "00-old", order: 1 })
    .returning();

  const [draftSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, title: "01-intro", order: 1 })
    .returning();

  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      title: "Welcome",
      order: 1,
      authoringStatus: "done",
    })
    .returning();

  const [lessonVideo] = await db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();

  const [clip1] = await db
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "0001",
      text: "hello",
    })
    .returning();
  const [clip2] = await db
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "b.mp4",
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "0003",
      text: "world",
    })
    .returning();
  const [archivedClip] = await db
    .insert(schema.clips)
    .values({
      videoId: lessonVideo!.id,
      videoFilename: "c.mp4",
      sourceStartTime: 20,
      sourceEndTime: 30,
      order: "0004",
      text: "deleted",
      archived: true,
    })
    .returning();
  await db.insert(schema.chapters).values({
    videoId: lessonVideo!.id,
    name: "Chapter One",
    order: "0002",
  });

  const [archivedLesson] = await db
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      title: "Deleted lesson",
      order: 2,
      authoringStatus: "done",
      archived: true,
    })
    .returning();

  const [archivedSection] = await db
    .insert(schema.sections)
    .values({
      repoVersionId: draftVersion!.id,
      title: "99-deleted",
      order: 99,
      archivedAt: new Date("2024-02-01T00:00:00Z"),
    })
    .returning();

  const [archivedLessonVideo] = await db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "deleted.mp4",
      originalFootagePath: "footage.mp4",
      archived: true,
    })
    .returning();

  await db.insert(schema.beats).values([
    {
      videoId: lessonVideo!.id,
      kind: "definition",
      title: "Active beat",
      order: "0001",
    },
    {
      videoId: lessonVideo!.id,
      kind: "definition",
      title: "Archived beat",
      order: "0002",
      archived: true,
    },
  ]);

  const [standaloneActive] = await db
    .insert(schema.videos)
    .values({ title: "standalone-active.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [standaloneArchived] = await db
    .insert(schema.videos)
    .values({
      title: "standalone-archived.mp4",
      originalFootagePath: "f.mp4",
      archived: true,
    })
    .returning();

  const [pitchActive] = await db
    .insert(schema.pitches)
    .values({ title: "Active pitch" })
    .returning();
  const [pitchArchived] = await db
    .insert(schema.pitches)
    .values({ title: "Archived pitch", archived: true })
    .returning();

  return {
    courseAId: courseA!.id,
    courseBArchivedId: courseB!.id,
    draftVersionId: draftVersion!.id,
    publishedVersionId: publishedVersion!.id,
    draftSectionId: draftSection!.id,
    oldSectionId: oldSection!.id,
    lessonId: lesson!.id,
    lessonVideoId: lessonVideo!.id,
    clip1Id: clip1!.id,
    clip2Id: clip2!.id,
    archivedClipId: archivedClip!.id,
    archivedLessonId: archivedLesson!.id,
    archivedSectionId: archivedSection!.id,
    archivedLessonVideoId: archivedLessonVideo!.id,
    standaloneActiveId: standaloneActive!.id,
    standaloneArchivedId: standaloneArchived!.id,
    pitchActiveId: pitchActive!.id,
    pitchArchivedId: pitchArchived!.id,
  };
};
