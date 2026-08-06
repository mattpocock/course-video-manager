/**
 * Shared world for the AutofillService tests.
 *
 * Real in every respect that matters — a real PGlite database with the real
 * schema, the real Drizzle query layer, the real operations services, the real
 * candidate rules and the real writes — with exactly one fake: TextGeneration,
 * the boundary to the model. The Autofill's rules are the behaviour under
 * test; what the model says is not.
 */

import { Effect, Layer } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import {
  chapters as chaptersTable,
  clips as clipsTable,
  courses,
  courseVersions,
  lessons as lessonsTable,
  sections as sectionsTable,
  videos as videosTable,
} from "@/db/schema";
import { AutofillService } from "@/services/autofill-service";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { createFakeTextGeneration } from "@/test-utils/fake-text-generation";
import type { TestDb } from "@/test-utils/pglite";

export type VideoSpec = {
  readonly title?: string;
  readonly body?: string | null;
  readonly description?: string | null;
  /** One entry per Clip: its transcript, and whether it has been transcribed. */
  readonly clips?: ReadonlyArray<{ text: string; transcribed?: boolean }>;
  /**
   * Chapter names in timeline order. An opening Chapter (`openingChapter`)
   * sits before the first Clip — without one the Video raises **Missing
   * Chapters**.
   */
  readonly openingChapter?: string | null;
};

export type LessonSpec = {
  readonly path: string;
  readonly authoringStatus?: "todo" | "done" | null;
  readonly videos: readonly VideoSpec[];
};

/**
 * A one-Section Course whose Draft Version holds the given Lessons. Clip text
 * carries whatever marker the spec puts in it, which is how a test steers the
 * fake TextGeneration at one Video without threading ids through the service.
 */
export const seedCourseVersion = async (
  testDb: TestDb,
  lessons: readonly LessonSpec[],
  opts?: { commitState?: "draft" | "pending" | "published" }
) => {
  const [course] = await testDb
    .insert(courses)
    .values({ name: "test-course" })
    .returning();
  const [version] = await testDb
    .insert(courseVersions)
    .values({
      repoId: course!.id,
      name: "v1",
      commitState: opts?.commitState ?? "draft",
    })
    .returning();
  const [section] = await testDb
    .insert(sectionsTable)
    .values({ repoVersionId: version!.id, title: "Intro", order: 1 })
    .returning();

  const videoIds: Record<string, string> = {};

  for (const [lessonIndex, lessonSpec] of lessons.entries()) {
    const [lesson] = await testDb
      .insert(lessonsTable)
      .values({
        sectionId: section!.id,
        title: lessonSpec.path,
        order: lessonIndex + 1,
        authoringStatus: lessonSpec.authoringStatus ?? "done",
      })
      .returning();

    for (const videoSpec of lessonSpec.videos) {
      const title = videoSpec.title ?? "Explainer";
      const [video] = await testDb
        .insert(videosTable)
        .values({
          lessonId: lesson!.id,
          title,
          originalFootagePath: "/tmp/footage.mp4",
          body: videoSpec.body === undefined ? "Lesson body" : videoSpec.body,
          description:
            videoSpec.description === undefined ? null : videoSpec.description,
        })
        .returning();
      videoIds[`${lessonSpec.path}/${title}`] = video!.id;

      const clipSpecs = videoSpec.clips ?? [{ text: "Hello world" }];
      // Real fractional-index keys: the chapter writer generates keys between
      // them, and the library refuses anything it did not mint itself.
      const clipOrders = generateNKeysBetween(null, null, clipSpecs.length + 1);
      for (const [clipIndex, clipSpec] of clipSpecs.entries()) {
        await testDb.insert(clipsTable).values({
          videoId: video!.id,
          videoFilename: "recording.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
          // Index 0 is left free so an opening Chapter can sit before the
          // first Clip.
          order: clipOrders[clipIndex + 1]!,
          text: clipSpec.text,
          transcribedAt: clipSpec.transcribed === false ? null : new Date(),
        });
      }

      if (videoSpec.openingChapter) {
        await testDb.insert(chaptersTable).values({
          videoId: video!.id,
          name: videoSpec.openingChapter,
          order: clipOrders[0]!,
        });
      }
    }
  }

  return { courseId: course!.id, versionId: version!.id, videoIds };
};

/** The AutofillService, wired to the test database and the given fake. */
export const makeAutofillTestLayer = (
  testDb: TestDb,
  fake: ReturnType<typeof createFakeTextGeneration>
) => {
  const drizzleLayer = Layer.succeed(DrizzleService, testDb as never);
  const opsLayer = Layer.mergeAll(
    VersionOperationsService.Default,
    LinkAuthOperationsService.Default,
    CourseOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  // DefaultWithoutDependencies, so the fake TextGeneration provided here is
  // the one the service gets — `.Default` would build its own real layer.
  const deps = Layer.mergeAll(opsLayer, drizzleLayer, fake.layer);
  return Layer.mergeAll(
    deps,
    AutofillService.DefaultWithoutDependencies.pipe(Layer.provide(deps))
  );
};

/** Every non-archived Chapter on a Video, in timeline order. */
export const readChapters = (testDb: TestDb, videoId: string) =>
  Effect.promise(() =>
    testDb.query.chapters.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.videoId, videoId), eq(table.archived, false)),
      orderBy: (table, { asc }) => asc(table.order),
    })
  );

export const readVideo = (testDb: TestDb, videoId: string) =>
  Effect.promise(() =>
    testDb.query.videos.findFirst({
      where: (table, { eq }) => eq(table.id, videoId),
    })
  );
