import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { clips } from "@/db/schema";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";

import {
  setupClipServiceTests,
  clipService,
  testDb,
  start,
} from "./clip-service-test-setup";
import { toDate } from "@/packages/clock";

setupClipServiceTests();

const NOW = "2026-10-12T09:00:00Z";

const stats = () =>
  clipService.getFootageStats({ now: toDate(NOW), timeZone: "UTC" });

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          CourseOperationsService.Default,
          VideoOperationsService.Default,
          VersionOperationsService.Default,
          LessonSectionOperationsService.Default
        ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)))
      ) as any
    )
  ) as Promise<A>;

const originsOn = async (videoId: string) =>
  (await testDb.query.clips.findMany({ where: eq(clips.videoId, videoId) }))
    .map((c) => c.origin)
    .sort();

describe("ClipService.getFootageStats — Clip Origin `copy`", () => {
  it("leaves the tally alone after user-made copies, and counts a Submitted take once", async () => {
    const { course, version, video } = await run(
      Effect.gen(function* () {
        const course = yield* (yield* CourseOperationsService).createCourse({
          name: "Course",
        });
        const versionOps = yield* VersionOperationsService;
        const version = yield* versionOps.createCourseVersion({
          repoId: course.id,
          name: "",
        });
        const lsOps = yield* LessonSectionOperationsService;
        const [section] = yield* lsOps.createSections({
          repoVersionId: version.id,
          sections: [{ sectionPathWithNumber: "01-intro", sectionNumber: 1 }],
        });
        const [lesson] = yield* lsOps.createLessons(section!.id, [
          { lessonPathWithNumber: "01.01-welcome", lessonNumber: 1 },
        ]);
        const video = yield* (yield* VideoOperationsService).createVideo(
          lesson!.id,
          { title: "Problem", originalFootagePath: "/f" }
        );
        return { course, version, video };
      })
    );

    // One 10-second take filmed today in the video editor.
    const [take] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: start,
      items: [],
      clips: [{ inputVideo: "take.mp4", startTime: 0, endTime: 10 }],
    });
    await testDb
      .update(clips)
      .set({ createdAt: toDate("2026-10-12T08:00:00Z") })
      .where(eq(clips.id, take!.id));

    const filmed = await stats();
    expect(filmed).toMatchObject({
      todaySeconds: 10,
      todayClips: 1,
      todayKeptClips: 1,
    });

    // Create video from selection, in "copy" mode: the original stays live.
    const selection = await clipService.createVideoFromSelection({
      sourceVideoId: video.id,
      clipIds: [take!.id],
      chapterIds: [],
      title: "Selection",
      mode: "copy",
    });
    // Duplicate Video.
    const duplicateId = await run(
      Effect.gen(function* () {
        return yield* (yield* VideoOperationsService).copyVideo({
          sourceVideoId: video.id,
          newTitle: "Problem",
          copyClips: true,
          copyBeats: false,
          copyScript: false,
          renameOld: true,
        });
      })
    );

    expect(await originsOn(selection.id)).toEqual(["copy"]);
    expect(await originsOn(duplicateId)).toEqual(["copy"]);
    expect(await stats()).toEqual(filmed);

    // Create video from selection, in "move" mode: the original is archived,
    // so the moved Clip is the take and keeps its Clip Origin.
    const moved = await clipService.createVideoFromSelection({
      sourceVideoId: video.id,
      clipIds: [take!.id],
      chapterIds: [],
      title: "Moved",
      mode: "move",
    });
    expect(await originsOn(moved.id)).toEqual(["video-editor"]);
    expect(await stats()).toEqual(filmed);

    // Submit: the new Draft holds new Versions of the same Videos, not
    // copies, so the take still counts, exactly once.
    await run(
      Effect.gen(function* () {
        return yield* (yield* VersionOperationsService).freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          newVersionName: "",
          sourceName: "v1.0.0",
          sourceDescription: "First release",
        });
      })
    );
    expect(await stats()).toEqual(filmed);
  });
});
