import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect } from "effect";
import type { Database } from "./drizzle-service.server.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import { createVideoFromSelectionImpl } from "./db-video-from-selection.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";
import { COPY_PATHS, type CopyPathName } from "./version-copy-manifest.js";
import {
  columnNamesBelow,
  generateTreeBelow,
  type Overrides,
  ROWS_PER_TABLE,
  signaturesBelow,
} from "../test-utils/copy-round-trip.js";

/**
 * The Video-level copy paths' round trip — Submit's is
 * db-version-copy.round-trip.test.ts. A fixture GENERATED from the Drizzle
 * schema fills every column of every table below a Video; each path copies
 * it; then every table the path declares `copied` in COPY_PATHS must come out
 * equal to the source, column for column, with ids and links remapped, and
 * every `notCopied` table empty. A Clip child table or column added later is
 * covered with no edit here — and fails until every path carries it.
 */

const VIDEO_PATHS = (Object.keys(COPY_PATHS) as CopyPathName[]).filter(
  (path) => COPY_PATHS[path].root === schema.videos
);

const ROOT = schema.videos;

/** Columns a Video-level copy deliberately does not carry, with why. */
const NOT_CARRIED: Record<string, string> = {
  "chapter.createdAt": "a copy is a new row",
  "beat.createdAt": "a copy is a new row",
  "clip_mockup.createdAt": "a copy is a new row",
  "clip_mockup_chapter.createdAt": "a copy is a new row",
  "thumbnail.createdAt": "a copy is a new row",
  "clip.order":
    "re-keyed in the copy's own order space (order is tested apart)",
  "chapter.order": "re-keyed, as clip.order",
  "beat.order": "re-keyed, as clip.order",
  "clip_mockup.order": "re-keyed, as clip.order",
  "clip_mockup_chapter.order": "re-keyed, as clip.order",
  "clip.origin":
    "every Video-level copy is a user-made copy, stamped `copy` (tested apart)",
};

/** CHECK constraints, and foreign keys that leave the Video tree. */
const overrides = (ctx: {
  snapshotId: string;
  learningGoalId: string;
  agentSessionId: string;
  keepsArchivedClips: boolean;
}): Overrides => ({
  // CHECK clip_transcription_status_valid; one non-default value per row, so
  // a copy that drops the status (back to "done") fails.
  "clip.transcriptionStatus": (i) => (i % 2 === 0 ? "failed" : "queued"),
  // On a path that keeps archived Clips, row 1 is one: it must arrive still
  // archived, with everything that hangs off it. The other paths copy only
  // the live timeline, so their fixture has no archived Clip.
  "clip.archived": (i) => ctx.keepsArchivedClips && i % 2 === 1,
  // CHECK clip_mockup_voice_status_valid. A READY voice is carried as it is,
  // WAV and all (and a ready one has no error); a failed one stays failed and
  // a pending one stays pending (`copiedVoice`).
  "clip_mockup.voiceStatus": () => "ready",
  "clip_mockup.voiceError": () => null,
  // CHECK clip_scene_override_valid.
  "clip.sceneOverride": () => "Code",
  // CHECK clip_origin_valid. The source is `cli`, so a copy that carried it
  // instead of stamping `copy` fails.
  "clip.origin": () => "cli",
  // CHECKs on a Recording Session and its scene events, which every copy
  // shares rather than copies.
  "recording_session.status": () => "stopped",
  "recording_session.silenceLength": () => "long",
  "recording_session.format": () => "short",
  "recording_session_scene_event.scene": () => "Code",
  // An AV Calibration is never copied, as a Recording Session is not.
  "recording_session.avCalibrationId": () => null,
  // Diagram Snapshots are shared per Diagram, not owned by a Video.
  "clip.diagramSnapshotId": () => ctx.snapshotId,
  // An Agent Session is shared by every copy of the Clips its entries are
  // on, as a Recording Session is. CHECKs on the entry's kind and via.
  "agent_session_entry.agentSessionId": () => ctx.agentSessionId,
  "agent_session_entry.kind": () => "skillCall",
  "agent_session_entry.via": () => "slashCommand",
  // A Learning Goal belongs to the Video's Section, which every copy shares.
  "beat_learning_goal.learningGoalId": () => ctx.learningGoalId,
  // CHECK clip_mockup_comment_one_parent: row 0 on a Clip Mockup, row 1 on
  // a Clip Mockup Chapter.
  "clip_mockup_comment.clipMockupId": (i) => (i % 2 === 0 ? undefined : null),
  "clip_mockup_comment.clipMockupChapterId": (i) =>
    i % 2 === 1 ? undefined : null,
});

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

async function generateVideoTree(path: CopyPathName) {
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
  const [diagram] = await testDb
    .insert(schema.diagrams)
    .values({ name: "Diagram" })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.diagramSnapshots)
    .values({ diagramId: diagram!.id, scene: {}, contentHash: "h" })
    .returning();
  const [agentSession] = await testDb
    .insert(schema.agentSessions)
    .values({ sourceSessionId: "claude-session" })
    .returning();
  await generateTreeBelow(
    testDb,
    ROOT,
    video!.id,
    overrides({
      snapshotId: snapshot!.id,
      learningGoalId: goal!.id,
      agentSessionId: agentSession!.id,
      keepsArchivedClips: COPY_PATHS[path].keepsArchived.includes("clip"),
    })
  );
  return video!;
}

/** Runs one Video-level path on the whole source; returns the copy's id. */
const RUN_PATH: Partial<
  Record<CopyPathName, (sourceVideoId: string) => Promise<string>>
> = {
  videoCopy: (sourceVideoId) =>
    Effect.runPromise(
      copyVideoImpl(db(), {
        sourceVideoId,
        newTitle: "Copy",
        copyClips: true,
        copyBeats: true,
        copyScript: true,
        renameOld: true,
      })
    ),
  createVideoFromSelection: async (sourceVideoId) => {
    const [clips, chapters] = await Promise.all([
      testDb.query.clips.findMany({
        where: (c, { eq }) => eq(c.videoId, sourceVideoId),
      }),
      testDb.query.chapters.findMany({
        where: (c, { eq }) => eq(c.videoId, sourceVideoId),
      }),
    ]);
    const copy = await Effect.runPromise(
      createVideoFromSelectionImpl(db(), {
        sourceVideoId,
        clipIds: clips.map((c) => c.id),
        chapterIds: chapters.map((c) => c.id),
        title: "Selection",
        mode: "copy",
      })
    );
    return copy.id;
  },
};

describe("Video-level copy paths round trip — the copy is the source, row for row", () => {
  it("names only real columns in NOT_CARRIED and the overrides", () => {
    const real = columnNamesBelow(ROOT);
    for (const name of [
      ...Object.keys(NOT_CARRIED),
      ...Object.keys(
        overrides({
          snapshotId: "",
          learningGoalId: "",
          agentSessionId: "",
          keepsArchivedClips: false,
        })
      ),
    ]) {
      expect(real.has(name), `stale entry "${name}"`).toBe(true);
    }
  });

  for (const path of VIDEO_PATHS) {
    it(`${path}: carries every column of every copied table, with ids remapped`, async () => {
      const run = RUN_PATH[path];
      expect(run, `teach RUN_PATH how to run ${path}`).toBeDefined();
      const source = await generateVideoTree(path);
      const copyId = await run!(source.id);

      const of = await signaturesBelow(
        testDb,
        ROOT,
        NOT_CARRIED,
        COPY_PATHS[path].tables
      );
      const before = of(source.id);
      const after = of(copyId);
      for (const [name, decision] of Object.entries(COPY_PATHS[path].tables)) {
        expect(
          before.get(name)!.length,
          `the fixture left "${name}" empty`
        ).toBe(ROWS_PER_TABLE);
        if (decision === "copied") {
          expect(
            after.get(name),
            `${path}: "${name}" did not round-trip`
          ).toEqual(before.get(name));
        } else {
          expect(after.get(name), `${path}: "${name}" is notCopied`).toEqual(
            []
          );
        }
      }

      const copiedClips = await testDb.query.clips.findMany({
        where: (c, { eq }) => eq(c.videoId, copyId),
      });
      expect(copiedClips.length).toBeGreaterThan(0);
      expect(
        copiedClips.map((c) => c.origin),
        `${path}: a user-made copy's Clips are stamped "copy"`
      ).toEqual(copiedClips.map(() => "copy"));
    });
  }
});
