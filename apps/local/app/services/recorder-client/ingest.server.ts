import { recordingSessions, recordingSessionSceneEvents } from "@/db/schema";
import type { DatabaseId } from "@cvm/core/db/ids";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";
import { asc, eq } from "drizzle-orm";
import { clipRecordingSessionRelation } from "@cvm/core/services/clip-recording-session-relation";
import { Effect } from "effect";
import { sceneSegments } from "@/packages/scene-layout";
import type { InsertionPoint } from "@/services/clip-service";
import {
  dbCall,
  getOrderedItems,
} from "@/services/clip-service-handler.helpers";
import { placeSpeechAsClips } from "@/services/clip-service-speech.server";
import type { Database } from "@/services/drizzle-service.server";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import type { SequencedEvent } from "./sequencer";

/**
 * What one recorder event means for the database: a Recording Session row
 * when it starts, stops (with its frames lost) or is found crashed, a scene
 * event row per scene change, Clips when speech ends. Idempotent, so an
 * event replayed after a restart changes nothing it already changed.
 *
 * Scene events and Clip bounds are both in picture time; speech arrives in
 * mic time and is moved to picture time (+ mic offset) before a Clip is cut
 * or its scene looked up (recorder-service/protocol.ts, TIME BASE).
 */

/** The picture's frame rate: the new recorder records the screen at 60 fps. */
export const NEW_RECORDER_FPS = 60;

export type IngestResult = {
  /** The Video the event is about; null when it means nothing to an editor. */
  videoId: string | null;
  messages: NewRecorderMessage[];
  /** Where the next Clip of this Video goes, when the event moved it. */
  insertionPoint: InsertionPoint | null;
};

const nothing: IngestResult = {
  videoId: null,
  messages: [],
  insertionPoint: null,
};

/** After the Video's last item: where Clips go when no editor said. */
const endOfVideo = Effect.fn("endOfVideo")(function* (
  db: Database,
  videoId: string
) {
  const last = (yield* getOrderedItems(db, videoId)).at(-1);
  if (!last) return { type: "start" } satisfies InsertionPoint;
  return last.type === "clip"
    ? ({ type: "after-clip", databaseClipId: last.id } satisfies InsertionPoint)
    : ({ type: "after-chapter", chapterId: last.id } satisfies InsertionPoint);
});

/** The scene in force at a picture time, by the layout module's rule. */
const sceneAt = Effect.fn("sceneAt")(function* (
  db: Database,
  recordingSessionId: string,
  pictureTime: number
) {
  const events = yield* dbCall(() =>
    db.query.recordingSessionSceneEvents.findMany({
      where: eq(
        recordingSessionSceneEvents.recordingSessionId,
        recordingSessionId
      ),
      orderBy: asc(recordingSessionSceneEvents.fileTime),
    })
  );
  const [first] = sceneSegments({
    events: events.map((e) => ({ scene: e.scene, atSeconds: e.fileTime })),
    clip: { startSeconds: pictureTime, endSeconds: pictureTime },
  });
  return first!.scene;
});

export const ingestRecorderEvent = Effect.fn("ingestRecorderEvent")(function* (
  db: Database,
  event: SequencedEvent,
  /** The insertion point the editor last gave for a Video, if any. */
  insertionPointFor: (videoId: string) => InsertionPoint | undefined
) {
  const recordingSessionId = event.recordingSessionId;
  if (event.type === "recording-started") {
    // A Recording Session hangs off its Video, so the Video's Version must
    // be the Draft (docs/DRAFT_GUARD.md). Refused, it is never saved, and
    // nor is anything after it: the editor is told, not retried.
    const refused = yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* requireDraftVersionForVideo(tx, event.videoId);
        yield* dbCall(() =>
          tx
            .insert(recordingSessions)
            .values({
              id: recordingSessionId,
              videoId: event.videoId,
              cameraFilePath: event.files.camera,
              screenFilePath: event.files.screen,
              micFilePath: event.files.mic,
              status: "recording",
              startedAt: new Date(event.t0Ms),
              silenceLength: event.silenceLength,
            })
            .onConflictDoNothing()
        );
      })
    ).pipe(
      Effect.as(false),
      Effect.catchTag("VersionNotDraftError", () => Effect.succeed(true))
    );
    if (refused)
      return {
        videoId: event.videoId,
        messages: [
          {
            type: "recorder-failed",
            message:
              "This Video's Version is not the Draft, so this recording is not saved.",
          },
        ],
        insertionPoint: null,
      } satisfies IngestResult;
    return {
      videoId: event.videoId,
      messages: [
        {
          type: "recording-started",
          recordingSessionId,
          silenceLength: event.silenceLength,
          micFile: event.files.mic,
        },
      ],
      insertionPoint: null,
    } satisfies IngestResult;
  }

  const session = yield* dbCall(() =>
    db.query.recordingSessions.findFirst({
      where: eq(recordingSessions.id, recordingSessionId),
    })
  );
  const videoId = session?.videoId;
  if (!session || !videoId) return nothing;

  switch (event.type) {
    case "screen-recorder-tuned":
      return nothing;
    case "scene-changed":
      // One row per logged event: its id is the event's (Recording Session,
      // seq), so a replay writes nothing new.
      yield* dbCall(() =>
        db
          .insert(recordingSessionSceneEvents)
          .values({
            id: `${recordingSessionId}:${event.seq}`,
            recordingSessionId,
            fileTime: event.fileTime,
            scene: event.scene,
          })
          .onConflictDoNothing()
      );
      return nothing;
    case "speech-started":
      return {
        videoId,
        messages: [{ type: "speech-started", recordingSessionId }],
        insertionPoint: null,
      } satisfies IngestResult;
    case "speech-ended": {
      // Speech is heard in mic file time; Clips are cut in the picture's,
      // which the mic runs ahead of by its offset.
      const offset = session.micOffsetMs / 1000;
      const speech = {
        startTime: event.startFileTime + offset,
        endTime: event.fileTime + offset,
      };
      const insertionPoint =
        insertionPointFor(videoId) ?? (yield* endOfVideo(db, videoId));
      const placed = yield* placeSpeechAsClips(db, {
        videoId,
        footagePath: session.micFilePath,
        insertionPoint,
        fps: NEW_RECORDER_FPS,
        speech: [speech],
        recordingSession: {
          id: recordingSessionId,
          scene: yield* sceneAt(db, recordingSessionId, speech.startTime),
        },
      });
      const last = placed.clips.at(-1);
      const messages: NewRecorderMessage[] = [
        { type: "speech-ended", recordingSessionId },
      ];
      if (last && placed.transcriptionJobId) {
        const recordingSession = yield* dbCall(() =>
          db.query.recordingSessions.findFirst({
            where: eq(recordingSessions.id, recordingSessionId),
            ...clipRecordingSessionRelation,
          })
        );
        messages.push({
          type: "clips-saved",
          recordingSessionId,
          clips: placed.clips.map((c) => ({
            ...c,
            id: c.id as DatabaseId,
            recordingSession: recordingSession!,
          })),
          placedAt: insertionPoint,
          transcriptionJobId: placed.transcriptionJobId,
        });
      }
      return {
        videoId,
        messages,
        insertionPoint: last
          ? { type: "after-clip", databaseClipId: last.id }
          : null,
      } satisfies IngestResult;
    }
    case "camera-lost":
      return {
        videoId,
        messages: [
          { type: "camera-lost", recordingSessionId, errors: event.errors },
        ],
        insertionPoint: null,
      } satisfies IngestResult;
    case "recording-stopped":
      yield* dbCall(() =>
        db
          .update(recordingSessions)
          .set({
            status: "stopped",
            cameraFramesLost: event.framesLost.camera,
            // Not measured yet (null): the column keeps its default 0.
            screenFramesLost: event.framesLost.screen ?? undefined,
          })
          .where(eq(recordingSessions.id, recordingSessionId))
      );
      return {
        videoId,
        messages: [
          {
            type: "recording-stopped",
            recordingSessionId,
            errors: event.errors,
            crashed: false,
            framesLost: event.framesLost,
          },
        ],
        insertionPoint: null,
      } satisfies IngestResult;
    case "recording-crashed":
      // Its Clips so far are already saved; a take still going at the crash
      // came in just before, ended where the repaired mic file ends.
      yield* dbCall(() =>
        db
          .update(recordingSessions)
          .set({ status: "crashed" })
          .where(eq(recordingSessions.id, recordingSessionId))
      );
      return {
        videoId,
        messages: [
          {
            type: "recording-stopped",
            recordingSessionId,
            errors: [],
            crashed: true,
            framesLost: null,
          },
        ],
        insertionPoint: null,
      } satisfies IngestResult;
  }
});

/** The Recording Sessions not yet seen to stop or crash. */
export const unfinishedRecordingSessions = Effect.fn(
  "unfinishedRecordingSessions"
)(function* (db: Database) {
  const rows = yield* dbCall(() =>
    db.query.recordingSessions.findMany({
      columns: { id: true },
      where: eq(recordingSessions.status, "recording"),
    })
  );
  return rows.map((r) => r.id);
});
