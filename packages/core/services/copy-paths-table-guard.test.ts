import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { makeDuplicateCourse } from "./db-course-duplicate.server.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import { createVideoFromSelectionImpl } from "./db-video-from-selection.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";
import {
  COPY_PATHS,
  countCarriedBelow,
  shortName,
  tablesBelow,
  type CopyPathName as PathName,
} from "./version-copy-manifest.js";

/**
 * The TABLE-level copy guard, for every copy path in COPY_PATHS. Hand-listed column
 * guards (db-duplicate-course-drift.test.ts) only see tables a path already
 * copies, which is how six child tables went uncopied by every path unnoticed.
 * Submit also has a schema-generated round trip
 * (db-version-copy.round-trip.test.ts) and checks itself at runtime
 * (version-copy-check.server.ts).
 *
 * This one derives, from the Drizzle schema's foreign keys, every table that
 * hangs below each copy path's root — a Course Version for Submit and
 * duplicateCourse, a Video for the Video-level paths — and demands a decision for
 * each in version-copy-manifest.ts: `copied`, or `notCopied` with the reason. A new child table fails here
 * until someone decides. The end-to-end test then holds each decision to the
 * truth: a `copied` table must have rows under the copy, a `notCopied` one none.
 */

// ---------------------------------------------------------------------------

let testDb: TestDb;
let versionLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  versionLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

/** One live row in every table below a Course Version. */
async function seedEveryTable() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "Section", order: 1 })
    .returning();
  const [goal] = await testDb
    .insert(schema.learningGoals)
    .values({ sectionId: section!.id, title: "Goal", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, title: "Lesson", order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({ lessonId: lesson!.id, title: "v.mp4", originalFootagePath: "/f" })
    .returning();
  const videoId = video!.id;
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "hi",
    })
    .returning();
  const clipId = clip!.id;
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId,
      cameraFilePath: "camera.mkv",
      screenFilePath: "screen.mkv",
      micFilePath: "take.mp4",
    })
    .returning();
  await testDb
    .insert(schema.recordingSessionSceneEvents)
    .values({ recordingSessionId: session!.id, fileTime: 0, scene: "Camera" });
  await testDb.insert(schema.chatHighlights).values({
    videoId,
    recordingSessionId: session!.id,
    broadcastId: "broadcast",
    messageId: "message",
    author: "@fake_viewer",
    text: "Fake question",
    shownAtMs: 1_000,
  });
  await testDb
    .update(schema.clips)
    .set({ recordingSessionId: session!.id })
    .where(eq(schema.clips.id, clipId));
  await testDb
    .insert(schema.clipWebLinks)
    .values({ clipId, url: "https://example.com" });
  await testDb
    .insert(schema.clipTranscriptWords)
    .values({ clipId, start: 0, end: 0.5, text: "hi" });
  await testDb.insert(schema.overlays).values({
    clipId,
    at: 1,
    durationInSeconds: 2,
    title: "Term",
    description: "Definition",
  });
  const [agentSession] = await testDb
    .insert(schema.agentSessions)
    .values({ sourceSessionId: "claude-session" })
    .returning();
  await testDb.insert(schema.agentSessionEntries).values({
    agentSessionId: agentSession!.id,
    clipId,
    footageTime: 1,
    sequence: 0,
    kind: "userPrompt",
    text: "Hi",
  });
  await testDb
    .insert(schema.chapters)
    .values({ videoId, name: "Chapter", order: "a0" });
  const [beat] = await testDb
    .insert(schema.beats)
    .values({ videoId, kind: "definition", title: "Beat", order: "a0" })
    .returning();
  await testDb
    .insert(schema.beatLearningGoals)
    .values({ beatId: beat!.id, learningGoalId: goal!.id });
  const [mockup] = await testDb
    .insert(schema.clipMockups)
    .values({
      videoId,
      line: "Line",
      imagePath: "a.png",
      audioPath: "a.wav",
      durationSeconds: 1,
      order: "a0",
    })
    .returning();
  await testDb
    .insert(schema.clipMockupChapters)
    .values({ videoId, name: "Part", order: "a1" });
  await testDb
    .insert(schema.clipMockupComments)
    .values({ videoId, clipMockupId: mockup!.id, body: "Note" });
  await testDb
    .insert(schema.thumbnails)
    .values({ videoId, layers: [], filePath: null });
  await testDb.insert(schema.videoPosts).values({ videoId, platform: "x" });
  return { course: course!, version: version!, video: video! };
}

/** Runs one copy path; returns the root row the copy hangs below. */
const RUN_PATH: Record<
  PathName,
  (seed: Awaited<ReturnType<typeof seedEveryTable>>) => Promise<string>
> = {
  submit: async ({ course, version }) => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      }).pipe(Effect.provide(versionLayer))
    );
    return result.version.id;
  },
  duplicateCourse: async ({ course }) => {
    const result = await Effect.runPromise(
      makeDuplicateCourse(db())({ sourceCourseId: course.id, name: "Copy" })
    );
    return result.version.id;
  },
  videoCopy: async ({ video }) =>
    Effect.runPromise(
      copyVideoImpl(db(), {
        sourceVideoId: video.id,
        newTitle: "Copy",
        copyClips: true,
        copyBeats: true,
        copyScript: true,
        renameOld: true,
      })
    ),
  createVideoFromSelection: async ({ video }) => {
    const [clips, chapters] = await Promise.all([
      testDb.query.clips.findMany({
        where: (c, { eq }) => eq(c.videoId, video.id),
      }),
      testDb.query.chapters.findMany({
        where: (c, { eq }) => eq(c.videoId, video.id),
      }),
    ]);
    const copy = await Effect.runPromise(
      createVideoFromSelectionImpl(db(), {
        sourceVideoId: video.id,
        clipIds: clips.map((c) => c.id),
        chapterIds: chapters.map((c) => c.id),
        title: "Selection",
        mode: "copy",
      })
    );
    return copy.id;
  },
};

const sourceRootId = (
  path: PathName,
  seed: Awaited<ReturnType<typeof seedEveryTable>>
) =>
  COPY_PATHS[path].root === schema.videos ? seed.video.id : seed.version.id;

describe("copy paths — table-level guard", () => {
  for (const [path, spec] of Object.entries(COPY_PATHS) as Array<
    [PathName, (typeof COPY_PATHS)[PathName]]
  >) {
    it(`${path}: decides every table below ${shortName(spec.root)} (add a child table => this fails)`, () => {
      const below = tablesBelow(spec.root).map(shortName).sort();
      expect(
        below,
        `a table hangs below "${shortName(spec.root)}" with no decision for ${path}: classify it in COPY_PATHS.${path} as "copied", or { notCopied: "<why>" }`
      ).toEqual(Object.keys(spec.tables).sort());
    });

    it(`${path}: copies exactly the tables it says it does`, async () => {
      const seed = await seedEveryTable();
      const below = tablesBelow(spec.root);
      // A table with no source row could never fail the check below.
      for (const table of below) {
        expect(
          await countCarriedBelow(db(), path, table, sourceRootId(path, seed)),
          `seedEveryTable() leaves "${shortName(table)}" empty — give it a row`
        ).toBeGreaterThan(0);
      }

      const copyRootId = await RUN_PATH[path](seed);

      for (const table of below) {
        const name = shortName(table);
        const copied = await countCarriedBelow(db(), path, table, copyRootId);
        if (spec.tables[name] === "copied") {
          expect(copied, `${path} did not copy "${name}"`).toBeGreaterThan(0);
        } else {
          expect(copied, `${path} copied "${name}", declared notCopied`).toBe(
            0
          );
        }
      }
    });
  }
});
