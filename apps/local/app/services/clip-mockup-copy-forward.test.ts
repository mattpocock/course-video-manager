import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { clipMockups } from "@/db/schema";
import {
  clipMockupFileExists,
  readClipMockupFile,
  writeClipMockupFile,
} from "@/services/clip-mockup-files";
import {
  copyClipMockupAssetsForVideo,
  copyClipMockupAssetsForVideos,
} from "@/services/clip-mockup-copy-forward.server";
import { makeTempClipMockupDir } from "@/cli/cli-write-test-harness";

// ===========================================================================
// Duplicating a Video leaves its Animatic PLAYABLE.
//
// A Clip Mockup is half a row and half a file. `copyVideoImpl` copies the
// rows verbatim but gives the duplicate a FRESH lineageId, so every
// `imagePath` and `audioPath` it copied now resolves into a directory that
// has nothing in it — sixty "frame missing" cards (#1669). The fix cannot
// live in `@cvm/core` (filesystem-free), so it is the duplicate's call site
// in `apps/local` that carries the files across; this suite runs exactly the
// sequence `POST /api/videos/:videoId/copy` runs.
// ===========================================================================

let testDb: TestDb;
let frames: ReturnType<typeof makeTempClipMockupDir>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  frames = makeTempClipMockupDir();
});

afterAll(() => {
  frames.cleanup();
});

const layer = () =>
  Layer.mergeAll(
    CourseOperationsService.Default,
    VideoOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    ClipMockupOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(layer() as any),
      Effect.provide(NodeContext.layer) as any
    ) as Effect.Effect<A, E, never>
  ) as Promise<A>;

const FRAME_ONE = new Uint8Array([1, 1, 1, 1]);
const FRAME_TWO = new Uint8Array([2, 2, 2, 2]);
const ARCHIVED_FRAME = new Uint8Array([9, 9, 9, 9]);
const SPEECH_ONE = new Uint8Array([10, 11, 12]);
const SPEECH_TWO = new Uint8Array([20, 21, 22]);

/** A Video with a three-Clip-Mockup Animatic, two live and one archived. */
const seed = async () => {
  await truncateAllTables(testDb);

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
      return { video: yield* videoOps.getVideoRowById(video.id) };
    })
  );

  const lineageId = seeded.video.lineageId;

  // The files, written the way `cvm clip-mockup add` writes them.
  await run(
    Effect.all([
      writeClipMockupFile(lineageId, "frame-001.png", FRAME_ONE),
      writeClipMockupFile(lineageId, "frame-002.png", FRAME_TWO),
      writeClipMockupFile(lineageId, "frame-archived.png", ARCHIVED_FRAME),
      writeClipMockupFile(lineageId, "speech-001.wav", SPEECH_ONE),
      writeClipMockupFile(lineageId, "speech-002.wav", SPEECH_TWO),
    ])
  );

  await testDb.insert(clipMockups).values([
    {
      videoId: seeded.video.id,
      line: "First line",
      imagePath: "frame-001.png",
      audioPath: "speech-001.wav",
      durationSeconds: 1.5,
      order: "a0",
    },
    {
      videoId: seeded.video.id,
      line: "Second line",
      imagePath: "frame-002.png",
      audioPath: "speech-002.wav",
      durationSeconds: 2.25,
      order: "a1",
    },
    {
      videoId: seeded.video.id,
      line: "Archived line",
      imagePath: "frame-archived.png",
      audioPath: "speech-002.wav",
      durationSeconds: 0.5,
      order: "a2",
      archived: true,
    },
  ]);

  return seeded.video;
};

/** Exactly what `POST /api/videos/:videoId/copy` does, in the same order. */
const duplicateVideo = (sourceVideoId: string) =>
  run(
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const sourceVideo = yield* videoOps.getVideoRowById(sourceVideoId);

      const newVideoId = yield* videoOps.copyVideo({
        sourceVideoId,
        newTitle: "Problem (copy)",
        copyClips: false,
        copyBeats: false,
        copyScript: false,
        renameOld: false,
      });

      const newVideo = yield* videoOps.getVideoRowById(newVideoId);
      const copied = yield* copyClipMockupAssetsForVideo({
        sourceLineageId: sourceVideo.lineageId,
        newLineageId: newVideo.lineageId,
        newVideoId,
      });

      return { sourceVideo, newVideo, copied };
    })
  );

/** The Animatic page's own missing-file check, per row. */
const animaticReport = (lineageId: string, videoId: string) =>
  run(
    Effect.gen(function* () {
      const clipMockupOps = yield* ClipMockupOperationsService;
      const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);
      return yield* Effect.all(
        rows.map((row) =>
          Effect.gen(function* () {
            const imageMissing = !(yield* clipMockupFileExists(
              lineageId,
              row.imagePath
            ));
            const audioMissing = !(yield* clipMockupFileExists(
              lineageId,
              row.audioPath
            ));
            return { line: row.line, imageMissing, audioMissing };
          })
        )
      );
    })
  );

describe("duplicating a Video carries its Animatic's files across", () => {
  beforeEach(async () => {
    await seed();
  });

  it("gives the duplicate a fresh lineageId — the reason the files must move", async () => {
    const source = await seed();
    const { sourceVideo, newVideo } = await duplicateVideo(source.id);

    expect(newVideo.lineageId).not.toBe(sourceVideo.lineageId);
  });

  it("leaves the duplicate's Animatic playable: no missing frame, no missing speech", async () => {
    const source = await seed();
    const { newVideo } = await duplicateVideo(source.id);

    expect(await animaticReport(newVideo.lineageId, newVideo.id)).toEqual([
      { line: "First line", imageMissing: false, audioMissing: false },
      { line: "Second line", imageMissing: false, audioMissing: false },
    ]);
  });

  it("copies the BYTES, not just the names", async () => {
    const source = await seed();
    const { newVideo } = await duplicateVideo(source.id);

    const [frameOne, frameTwo, speechOne, speechTwo] = await run(
      Effect.all([
        readClipMockupFile(newVideo.lineageId, "frame-001.png"),
        readClipMockupFile(newVideo.lineageId, "frame-002.png"),
        readClipMockupFile(newVideo.lineageId, "speech-001.wav"),
        readClipMockupFile(newVideo.lineageId, "speech-002.wav"),
      ])
    );

    expect(Array.from(frameOne!)).toEqual(Array.from(FRAME_ONE));
    expect(Array.from(frameTwo!)).toEqual(Array.from(FRAME_TWO));
    expect(Array.from(speechOne!)).toEqual(Array.from(SPEECH_ONE));
    expect(Array.from(speechTwo!)).toEqual(Array.from(SPEECH_TWO));
  });

  it("does not copy an archived Clip Mockup's frame", async () => {
    const source = await seed();
    const { newVideo } = await duplicateVideo(source.id);

    const present = await run(
      clipMockupFileExists(newVideo.lineageId, "frame-archived.png")
    );
    expect(present).toBe(false);
  });

  it("does the same for every Video in a duplicated Course", async () => {
    const source = await seed();

    // Exactly what `POST /api/courses/:courseId/duplicate` does.
    const duplicate = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        const videoOps = yield* VideoOperationsService;
        const sourceVideo = yield* videoOps.getVideoRowById(source.id);
        const lesson = yield* videoOps.getVideoDeepById(source.id);

        const result = yield* courseOps.duplicateCourse({
          sourceCourseId: lesson.lesson!.section.repoVersion.repo.id,
          name: "test-course (copy)",
        });
        yield* copyClipMockupAssetsForVideos(result.videoLineageMappings);
        return { sourceVideo, mappings: result.videoLineageMappings };
      })
    );

    expect(duplicate.mappings).toHaveLength(1);
    const copy = duplicate.mappings[0]!;
    expect(copy.newLineageId).not.toBe(duplicate.sourceVideo.lineageId);

    expect(await animaticReport(copy.newLineageId, copy.newVideoId)).toEqual([
      { line: "First line", imageMissing: false, audioMissing: false },
      { line: "Second line", imageMissing: false, audioMissing: false },
    ]);
    expect(
      await run(clipMockupFileExists(copy.newLineageId, "frame-archived.png"))
    ).toBe(false);
  });

  it("leaves the SOURCE Video's Animatic exactly as it found it", async () => {
    const source = await seed();
    const { sourceVideo } = await duplicateVideo(source.id);

    expect(await animaticReport(sourceVideo.lineageId, sourceVideo.id)).toEqual(
      [
        { line: "First line", imageMissing: false, audioMissing: false },
        { line: "Second line", imageMissing: false, audioMissing: false },
      ]
    );
  });
});
