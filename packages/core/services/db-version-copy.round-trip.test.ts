import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";
import { COPY_PATHS } from "./version-copy-manifest.js";
import {
  columnNamesBelow,
  generateTreeBelow,
  type Overrides,
  ROWS_PER_TABLE,
  signaturesBelow,
} from "../test-utils/copy-round-trip.js";

/**
 * Submit's round-trip invariant. A fixture GENERATED from the Drizzle schema
 * puts two rows with non-default values in every column of every table below
 * a Course Version; Submit clones it; then every table's rows in the new Draft
 * must equal the source's, column for column, with each id and foreign key
 * replaced by the content of the row it points at. That catches a dropped
 * column (#1834), a missing table (#1839) and a wrong remap — a link pointing
 * back into the source Version — alike.
 *
 * A new table or column is covered with no edit here. A column type the
 * generator cannot fill fails loudly, and so does a column Submit drops that
 * is not in NOT_CARRIED with its reason.
 */

const ROOT = COPY_PATHS.submit.root;

/** Columns a copy deliberately does not carry, as `table.key`, with why. */
const NOT_CARRIED: Record<string, string> = {
  "section.previousVersionSectionId": "points at its source row (checked)",
  "lesson.previousVersionLessonId": "points at its source row (checked)",
  "section.createdAt": "a copy is a new row",
  "learning_goal.createdAt": "a copy is a new row",
  "lesson.createdAt": "a copy is a new row",
  "video.createdAt": "a copy is a new row",
  "video.updatedAt": "a copy is a new row",
  "chapter.createdAt": "a copy is a new row",
  "beat.createdAt": "a copy is a new row",
  "clip_mockup.createdAt": "a copy is a new row",
  "clip_mockup_chapter.createdAt": "a copy is a new row",
  "thumbnail.createdAt": "a copy is a new row",
};

/**
 * Values the generator must not choose itself: CHECK constraints, and foreign
 * keys that leave the Version tree. Called per row; `i` is the row's index.
 */
const overrides = (ctx: {
  snapshotId: string;
  agentSessionId: string;
}): Overrides => ({
  // CHECK video_format_valid; "short" is the non-default value.
  "video.format": () => "short",
  // A course Video never has a Pitch (moving one into a Lesson clears it).
  "video.pitchId": () => null,
  // CHECK clip_transcription_status_valid; one non-default value per row, so
  // a copy that drops the status (back to "done") fails.
  "clip.transcriptionStatus": (i) => (i % 2 === 0 ? "failed" : "queued"),
  // Row 1 is an archived Clip: Submit carries it, still archived, with its
  // Transcript Words, Web Links and Overlays (KEEPS_ARCHIVED_CLIPS).
  "clip.archived": (i) => i % 2 === 1,
  // CHECK clip_mockup_voice_status_valid. A READY voice is carried as it is,
  // WAV and all (and a ready one has no error); a failed one stays failed and
  // a pending one stays pending (`copiedVoice`).
  "clip_mockup.voiceStatus": () => "ready",
  "clip_mockup.voiceError": () => null,
  // CHECK video_recorder_valid; "cvm" is the non-default value.
  "video.recorder": () => "cvm",
  // CHECK clip_scene_override_valid.
  "clip.sceneOverride": () => "Code",
  // CHECK posting_queue_entry_state_valid; an ended state, so a Short's two
  // rows don't break its one-live-entry index. Never copied.
  "posting_queue_entry.state": () => "posted",
  // CHECKs on a Layer's kind and session file.
  "clip_layer.kind": () => "footage",
  "clip_layer.sessionFile": () => "screen",
  // CHECK clip_origin_valid; the non-default value, so a copy that drops
  // it (back to "video-editor") fails.
  "clip.origin": () => "cli",
  // CHECKs on a Recording Session and its scene events, which every copy
  // shares rather than copies.
  "recording_session.status": () => "stopped",
  "recording_session.silenceLength": () => "long",
  "recording_session.format": () => "short",
  "recording_session_scene_event.scene": () => "Code",
  // An AV Calibration is never copied, as a Recording Session is not.
  "recording_session.avCalibrationId": () => null,
  // Diagram Snapshots are shared per Diagram, not owned by a Version.
  "clip.diagramSnapshotId": () => ctx.snapshotId,
  // An Agent Session is shared by every copy of the Clips its entries are
  // on, as a Recording Session is. CHECKs on the entry's kind and via.
  "agent_session_entry.agentSessionId": () => ctx.agentSessionId,
  "agent_session_entry.kind": () => "skillCall",
  "agent_session_entry.via": () => "slashCommand",
  // CHECK clip_mockup_comment_one_parent: row 0 on a Clip Mockup, row 1 on
  // a Clip Mockup Chapter.
  "clip_mockup_comment.clipMockupId": (i) => (i % 2 === 0 ? undefined : null),
  "clip_mockup_comment.clipMockupChapterId": (i) =>
    i % 2 === 1 ? undefined : null,
});

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function generateVersionTree() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
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
    version!.id,
    overrides({ snapshotId: snapshot!.id, agentSessionId: agentSession!.id })
  );
  return { course: course!, version: version! };
}

describe("Submit round trip — the new Draft is the old one, row for row", () => {
  it("names only real columns in NOT_CARRIED and the overrides", () => {
    const real = columnNamesBelow(ROOT);
    for (const name of [
      ...Object.keys(NOT_CARRIED),
      ...Object.keys(overrides({ snapshotId: "", agentSessionId: "" })),
    ]) {
      expect(real.has(name), `stale entry "${name}"`).toBe(true);
    }
  });

  it("carries every column of every copied table, with ids remapped", async () => {
    const { course, version } = await generateVersionTree();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      }).pipe(Effect.provide(testLayer))
    );

    const of = await signaturesBelow(
      testDb,
      ROOT,
      NOT_CARRIED,
      COPY_PATHS.submit.tables
    );
    const source = of(version.id);
    const copy = of(result.version.id);
    for (const [name, decision] of Object.entries(COPY_PATHS.submit.tables)) {
      expect(source.get(name)!.length, `the fixture left "${name}" empty`).toBe(
        ROWS_PER_TABLE
      );
      if (decision === "copied") {
        expect(copy.get(name), `"${name}" did not round-trip`).toEqual(
          source.get(name)
        );
      } else {
        expect(copy.get(name), `"${name}" is notCopied`).toEqual([]);
      }
    }

    // previousVersion*Id is the one carried link that SHOULD point back.
    const sourceSections = new Set(
      (
        await testDb.query.sections.findMany({
          where: (s, { eq }) => eq(s.repoVersionId, version.id),
        })
      ).map((s) => s.id)
    );
    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });
    for (const section of newSections) {
      expect(sourceSections.has(section.previousVersionSectionId!)).toBe(true);
    }
    const sourceLessonIds = new Set(
      (
        await testDb.query.lessons.findMany({
          where: (l, { inArray }) => inArray(l.sectionId, [...sourceSections]),
        })
      ).map((l) => l.id)
    );
    for (const lesson of newSections.flatMap((s) => s.lessons)) {
      expect(sourceLessonIds.has(lesson.previousVersionLessonId!)).toBe(true);
    }
  });
});
