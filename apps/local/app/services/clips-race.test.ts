/**
 * Regression tests for the clips-during-publish race (issues #1349/#1403),
 * deliberately independent of the Dropbox publish path: "publish" here is just
 * Submit (freezeAndCloneVersion), which is the only step a clip write can race.
 *
 * The locked design: every guarded write runs its draft-guard check and its
 * insert in ONE transaction holding `SELECT … FOR UPDATE` on the owning
 * CourseVersion row, and Submit takes the same row lock before cloning — so a
 * write either lands before the clone (and is carried into the new Draft) or
 * fails with the terminal VersionNotDraftError. Never a stranded clip.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { drizzle } from "drizzle-orm/pglite";
import type { PGlite } from "@electric-sql/pglite";
import * as schema from "@/db/schema";
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
import { handleClipServiceEvent } from "@/services/clip-service-handler";
import { createClipOperations } from "@/services/db-clip-operations.server";
import { clips as clipsTable } from "@/db/schema";
import { eq } from "drizzle-orm";

let testDb: TestDb;
let pglite: PGlite;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  pglite = result.pglite as PGlite;
});

const makeRunner = (db: TestDb) => {
  const drizzleLayer = Layer.succeed(DrizzleService, db as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    ClipOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  return <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(dbLayer) as any)
    ) as Promise<A>;
};

const setup = async () => {
  await truncateAllTables(testDb);
  const run = makeRunner(testDb);

  const seeded = await run(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const lsOps = yield* LessonSectionOperationsService;
      const videoOps = yield* VideoOperationsService;

      const course = yield* courseOps.createCourse({ name: "race-course" });
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
      return { course, version, video };
    })
  );

  const submit = () =>
    run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: seeded.version.id,
          repoId: seeded.course.id,
          newVersionName: "",
          sourceName: "v1.0.0",
          sourceDescription: "First release",
        });
      })
    );

  const clipCountForVideo = async (videoId: string) =>
    (
      await testDb.query.clips.findMany({
        where: eq(clipsTable.videoId, videoId),
      })
    ).length;

  return { ...seeded, run, submit, clipCountForVideo };
};

const failureTagOfExit = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Exit.match(exit, {
        onFailure: (cause) =>
          (cause as any).error?._tag ??
          JSON.stringify(cause, null, 2).match(/"_tag":\s*"(\w+)"/)?.[1],
        onSuccess: () => "no-error",
      })
    : "no-error";

describe("clips-during-publish race (#1403)", () => {
  it("an OBS append whose detection straddles Submit fails terminally and strands no clip", async () => {
    const { video, submit, clipCountForVideo } = await setup();
    const before = await clipCountForVideo(video.id);

    // The real race shape: OBS silence detection is slow, and the publish
    // (Submit) lands while it runs. The adapter performs the Submit *inside*
    // getLatestOBSVideoClips — after the handler's pre-flight resolution,
    // before the insert.
    const exit = await Effect.runPromiseExit(
      handleClipServiceEvent(
        testDb as any,
        {
          type: "append-from-obs",
          input: {
            videoId: video.id,
            filePath: "C:\\rec\\session.mp4",
            insertionPoint: { type: "start" },
          },
        },
        {
          getLatestOBSVideoClips: async () => {
            await submit();
            return {
              clips: [
                {
                  inputVideo: "/mnt/c/rec/session.mp4",
                  startTime: 0,
                  endTime: 5,
                },
              ],
            };
          },
        }
      )
    );

    expect(failureTagOfExit(exit)).toBe("VersionNotDraftError");
    // The frozen (now Pending) version's video gained no clip.
    expect(await clipCountForVideo(video.id)).toBe(before);
  });

  it("a guarded handler write after Submit fails with VersionNotDraftError and inserts nothing", async () => {
    const { video, submit, clipCountForVideo } = await setup();
    await submit();
    const before = await clipCountForVideo(video.id);

    const exit = await Effect.runPromiseExit(
      handleClipServiceEvent(
        testDb as any,
        {
          type: "append-clips",
          input: {
            videoId: video.id,
            insertionPoint: { type: "start" },
            clips: [{ inputVideo: "x.mp4", startTime: 0, endTime: 1 }],
          },
        },
        { getLatestOBSVideoClips: async () => ({ clips: [] }) }
      )
    );

    expect(failureTagOfExit(exit)).toBe("VersionNotDraftError");
    expect(await clipCountForVideo(video.id)).toBe(before);
  });

  // The same-transaction guarantee itself is structural (transactionalizeWrites
  // re-instantiates the ops factory with the transaction handle), so these two
  // assert the SQL the mechanism depends on: the version-row FOR UPDATE is
  // emitted, and on the right side of the write / the clone.
  it("the draft-guard takes FOR UPDATE on the version row before the clip insert", async () => {
    const { video } = await setup();

    // A second drizzle handle over the same PGlite, with a query logger:
    // the mechanism assertion is on the emitted SQL, not on timing.
    const queries: string[] = [];
    const loggedDb = drizzle(pglite, {
      schema,
      logger: { logQuery: (q) => queries.push(q.toLowerCase()) },
    });

    await Effect.runPromise(
      createClipOperations(loggedDb as any).appendClips({
        videoId: video.id,
        insertionPoint: { type: "start" },
        clips: [{ inputVideo: "y.mp4", startTime: 0, endTime: 2 }],
      }) as Effect.Effect<unknown, never, never>
    );

    const idxLock = queries.findIndex(
      (q) => q.includes(`course_version"`) && q.includes("for update")
    );
    const idxInsert = queries.findIndex(
      (q) => q.startsWith("insert") && q.includes(`_clip"`)
    );
    expect(idxLock).toBeGreaterThanOrEqual(0);
    expect(idxInsert).toBeGreaterThan(idxLock);
  });

  it("Submit locks the version row FOR UPDATE before cloning", async () => {
    const { course, version } = await setup();

    const queries: string[] = [];
    const loggedDb = drizzle(pglite, {
      schema,
      logger: { logQuery: (q) => queries.push(q.toLowerCase()) },
    });
    const runLogged = makeRunner(loggedDb as any);

    await runLogged(
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

    const idxLock = queries.findIndex(
      (q) => q.includes(`course_version"`) && q.includes("for update")
    );
    const idxCloneInsert = queries.findIndex(
      (q) => q.startsWith("insert") && q.includes(`_section"`)
    );
    expect(idxLock).toBeGreaterThanOrEqual(0);
    expect(idxCloneInsert).toBeGreaterThan(idxLock);
  });
});
