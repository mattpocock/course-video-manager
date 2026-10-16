/**
 * A Recording Session is shared by every copy of its Clips (a new Draft, a
 * Course duplicate, a Video copy), and its mic offset joins the Export Hash of
 * every one. So an offset change is refused while any Clip of the Session sits
 * in a Version that is not a Draft: the Submitted Version's export must not
 * move under it (issue #2010).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { handleClipServiceEvent } from "@/services/clip-service-handler";
import * as schema from "@/db/schema";
import { MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE } from "@/services/recording-session-shared-message";
import { clipRecordingSessionRelation } from "@cvm/core/services/clip-recording-session-relation";
import { computeExportHash, toExportClips } from "@/services/export-hash";

let testDb: TestDb;
beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          CourseOperationsService.Default,
          VideoOperationsService.Default,
          VersionOperationsService.Default,
          LessonSectionOperationsService.Default,
          ClipOperationsService.Default
        ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)))
      ) as any
    )
  ) as Promise<A>;

const send = (event: any) =>
  Effect.runPromiseExit(handleClipServiceEvent(testDb as any, event));

const exportHashOf = async (videoId: string) =>
  computeExportHash(
    toExportClips(
      (
        await testDb.query.clips.findMany({
          where: eq(schema.clips.videoId, videoId),
          with: { recordingSession: clipRecordingSessionRelation },
        })
      ).map((c) => ({ ...c, overlays: [] }))
    ),
    "landscape",
    []
  );

describe("update-mic-offset on a shared Recording Session", () => {
  it("is refused once a Submitted Version shares the Session, leaving its export alone", async () => {
    await truncateAllTables(testDb);
    const { course, version, video } = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        const versionOps = yield* VersionOperationsService;
        const lsOps = yield* LessonSectionOperationsService;
        const videoOps = yield* VideoOperationsService;
        const course = yield* courseOps.createCourse({ name: "c" });
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
          originalFootagePath: "/rec",
        });
        return { course, version, video };
      })
    );
    const [session] = await testDb
      .insert(schema.recordingSessions)
      .values({
        videoId: video.id,
        cameraFilePath: "/rec/camera.mkv",
        screenFilePath: "/rec/screen.mkv",
        micFilePath: "/rec/mic.mkv",
        status: "stopped",
      })
      .returning();
    const [frozenClip] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video.id,
        videoFilename: "/rec/mic.mkv",
        sourceStartTime: 10,
        sourceEndTime: 20,
        order: "a0",
        text: "",
        scene: "Code",
        recordingSessionId: session!.id,
      })
      .returning();

    // While every Clip of the Session is in a Draft, the offset changes.
    const beforeSubmit = await send({
      type: "update-mic-offset",
      clipId: frozenClip!.id,
      micOffsetMs: 100,
    });
    expect(Exit.isSuccess(beforeSubmit)).toBe(true);

    const result: any = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          newVersionName: "",
          sourceName: "v1.0.0",
          sourceDescription: "First release",
        });
      })
    );
    const draftVideoId = result.videoIdMappings[0].newVideoId;
    const [draftClip] = await testDb.query.clips.findMany({
      where: eq(schema.clips.videoId, draftVideoId),
    });
    const frozenHashBefore = await exportHashOf(video.id);

    // The guard refuses the edit on the frozen Version itself...
    const direct = await send({
      type: "update-mic-offset",
      clipId: frozenClip!.id,
      micOffsetMs: 300,
    });
    expect(Exit.isFailure(direct)).toBe(true);
    expect(JSON.stringify(direct)).toMatch(/VersionNotDraftError/);

    // ...and so is the same edit through the Draft's copy of the Clip,
    const viaDraft = await send({
      type: "update-mic-offset",
      clipId: draftClip!.id,
      micOffsetMs: 300,
    });
    if (!Exit.isFailure(viaDraft)) throw new Error("expected a refusal");
    expect((Cause.squash(viaDraft.cause) as Error).message).toBe(
      MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE
    );

    // ...so the Submitted Version's export is unchanged.
    expect(await exportHashOf(video.id)).toBe(frozenHashBefore);
  });
});
