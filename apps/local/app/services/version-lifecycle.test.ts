import { describe, it, expect, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { clips as clipsTable } from "@/db/schema";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setup = async () => {
  await truncateAllTables(testDb);

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    ClipOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(dbLayer) as any)
    ) as Promise<A>;

  const seeded = await run(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lsOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const course = yield* courseOps.createCourse({ name: "test-course" });
      const version = yield* versionOps.createCourseVersion({
        repoId: course.id,
        name: "",
      });
      const [section] = yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
      });
      const [lesson] = yield* lsOps.createLessons(section!.id, [
        { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
      ]);
      const video = yield* videoOps.createVideo(lesson!.id, {
        title: "Problem",
        originalFootagePath: "/tmp/footage.mp4",
      });
      return { course, version, section: section!, lesson: lesson!, video };
    })
  );

  const [clip] = await testDb
    .insert(clipsTable)
    .values({
      videoId: seeded.video.id,
      videoFilename: "recording.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello",
      pauseType: "none",
    })
    .returning();

  return { ...seeded, clip: clip!, run };
};

const submit = (input: { sourceVersionId: string; repoId: string }) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.freezeAndCloneVersion({
      ...input,
      newVersionName: "",
      sourceName: "v1.0.0",
      sourceDescription: "First release",
    });
  });

const failureTag = <A>(effect: Effect.Effect<A, any, any>) =>
  effect.pipe(
    Effect.map(() => "no-error"),
    Effect.catchAll((e) => Effect.succeed((e as any)._tag as string))
  );

describe("CourseVersion lifecycle (Draft → Pending → Published)", () => {
  it("Submit stamps the Pending Version and clones a fresh Draft", async () => {
    const { course, version, run } = await setup();

    const versions = await run(
      Effect.gen(function* () {
        yield* submit({ sourceVersionId: version.id, repoId: course.id });
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.getCourseVersions(course.id);
      })
    );

    expect(versions).toHaveLength(2);
    const pending = versions.find((v) => v.id === version.id);
    const draft = versions.find((v) => v.id !== version.id);
    expect(pending).toMatchObject({
      name: "v1.0.0",
      description: "First release",
      commitState: "pending",
    });
    expect(draft).toMatchObject({ name: "", commitState: "draft" });
  });

  it("Submit refuses while a Pending Version already exists", async () => {
    const { course, version, run } = await setup();

    const tag = await run(
      Effect.gen(function* () {
        yield* submit({ sourceVersionId: version.id, repoId: course.id });
        const versionOps = yield* VersionOperationsService;
        const latest = yield* versionOps.getLatestCourseVersion(course.id);
        return yield* failureTag(
          submit({ sourceVersionId: latest!.id, repoId: course.id })
        );
      })
    );

    expect(tag).toBe("PendingVersionExistsError");
  });

  it("Promote publishes a Pending Version and refuses anything else", async () => {
    const { course, version, run } = await setup();

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        yield* submit({ sourceVersionId: version.id, repoId: course.id });
        const promoted = yield* versionOps.promotePendingVersion(version.id);
        // Second promote: no longer pending.
        const repeatTag = yield* failureTag(
          versionOps.promotePendingVersion(version.id)
        );
        const draft = yield* versionOps.getLatestCourseVersion(course.id);
        const draftTag = yield* failureTag(
          versionOps.promotePendingVersion(draft!.id)
        );
        return { promoted, repeatTag, draftTag };
      })
    );

    expect(result.promoted.commitState).toBe("published");
    expect(result.repeatTag).toBe("VersionNotPendingError");
    expect(result.draftTag).toBe("VersionNotPendingError");
  });

  it("Discard deletes only a Pending Version", async () => {
    const { course, version, run } = await setup();

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        yield* submit({ sourceVersionId: version.id, repoId: course.id });
        yield* versionOps.discardPendingVersion(version.id);
        const afterDiscard = yield* versionOps.getCourseVersions(course.id);

        // The remaining Draft must refuse Discard…
        const draftTag = yield* failureTag(
          versionOps.discardPendingVersion(afterDiscard[0]!.id)
        );

        // …and so must a Published Version.
        yield* submit({
          sourceVersionId: afterDiscard[0]!.id,
          repoId: course.id,
        });
        yield* versionOps.promotePendingVersion(afterDiscard[0]!.id);
        const publishedTag = yield* failureTag(
          versionOps.discardPendingVersion(afterDiscard[0]!.id)
        );

        return { afterDiscard, draftTag, publishedTag };
      })
    );

    expect(result.afterDiscard).toHaveLength(1);
    expect(result.afterDiscard[0]).toMatchObject({
      name: "",
      commitState: "draft",
    });
    expect(result.draftTag).toBe("VersionNotPendingError");
    expect(result.publishedTag).toBe("VersionNotPendingError");
  });

  it("renaming a non-Draft version is refused", async () => {
    const { course, version, run } = await setup();

    const tag = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        yield* submit({ sourceVersionId: version.id, repoId: course.id });
        return yield* failureTag(
          versionOps.updateCourseVersion({
            versionId: version.id,
            name: "v9.9.9",
            description: "nope",
          })
        );
      })
    );

    expect(tag).toBe("CannotUpdatePublishedVersionError");
  });
});

describe("write-closure (VersionNotDraftError)", () => {
  const freeze = (sourceVersionId: string, repoId: string) =>
    Effect.gen(function* () {
      yield* submit({ sourceVersionId, repoId });
      const versionOps = yield* VersionOperationsService;
      yield* versionOps.promotePendingVersion(sourceVersionId);
    });

  it("rejects section, lesson, video, and clip writes into a Published Version", async () => {
    const { course, version, section, lesson, video, clip, run } =
      await setup();

    const tags = await run(
      Effect.gen(function* () {
        yield* freeze(version.id, course.id);
        const lsOps = yield* LessonSectionOperationsService;
        const videoOps = yield* VideoOperationsService;
        const clipOps = yield* ClipOperationsService;

        return {
          createSection: yield* failureTag(
            lsOps.createSections({
              repoVersionId: version.id,
              sections: [
                { sectionPathWithNumber: "02-more", sectionNumber: 2 },
              ],
            })
          ),
          renameSection: yield* failureTag(
            lsOps.updateSectionTitle(section.id, "new title")
          ),
          updateLesson: yield* failureTag(
            lsOps.updateLesson(lesson.id, { title: "renamed" })
          ),
          deleteLesson: yield* failureTag(lsOps.deleteLesson(lesson.id)),
          createVideo: yield* failureTag(
            videoOps.createVideo(lesson.id, {
              title: "Another",
              originalFootagePath: "/tmp/other.mp4",
            })
          ),
          renameVideo: yield* failureTag(
            videoOps.updateVideoTitle({ videoId: video.id, title: "Renamed" })
          ),
          updateClip: yield* failureTag(
            clipOps.updateClip(clip.id, { text: "edited" })
          ),
          archiveClip: yield* failureTag(clipOps.archiveClip(clip.id)),
          appendClips: yield* failureTag(
            clipOps.appendClips({
              videoId: video.id,
              insertionPoint: { type: "start" },
              clips: [{ inputVideo: "x.mp4", startTime: 0, endTime: 1 }],
            })
          ),
        };
      })
    );

    for (const [name, tag] of Object.entries(tags)) {
      expect(tag, name).toBe("VersionNotDraftError");
    }
  });

  it("still accepts writes into the Draft clone", async () => {
    const { course, version, run } = await setup();

    const result = await run(
      Effect.gen(function* () {
        yield* freeze(version.id, course.id);
        const versionOps = yield* VersionOperationsService;
        const lsOps = yield* LessonSectionOperationsService;
        const draft = yield* versionOps.getLatestCourseVersion(course.id);
        const [newSection] = yield* lsOps.createSections({
          repoVersionId: draft!.id,
          sections: [{ sectionPathWithNumber: "02-more", sectionNumber: 2 }],
        });
        return { draft: draft!, newSection };
      })
    );

    expect(result.draft.commitState).toBe("draft");
    expect(result.newSection).toBeDefined();
  });
});
