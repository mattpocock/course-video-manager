import { recordingSessions, recordingSessionSceneEvents } from "@/db/schema";
import type { DatabaseId } from "@cvm/core/db/ids";
import type {
  ClipSpan,
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import { asc, eq, inArray, or } from "drizzle-orm";
import { clipRecordingSessionRelation } from "@cvm/core/services/clip-recording-session-relation";
import { Data, Effect } from "effect";
import { sceneSegments } from "@/packages/scene-layout";
import { toRootRelative } from "@/packages/storage";
import { storageRootsConfig } from "@/services/storage-roots";
import type { InsertionPoint } from "@/services/clip-service";
import {
  dbCall,
  getOrderedItems,
} from "@/services/clip-service-handler.helpers";
import { placeSpeechAsClips } from "@/services/clip-service-speech.server";
import { speechToClipBounds } from "@/services/silence-detection";
import type { Database } from "@/services/drizzle-service.server";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { pairMicOffsetMs } from "@/services/av-calibration.server";
import { DEFAULT_MIC_OFFSET_MS } from "@cvm/core/features/videos/recorder";
import type { SequencedEvent } from "./sequencer";

/**
 * What one recorder event means for the database: a Recording Session row
 * when it starts, stops (with its frames lost) or is found crashed, a scene
 * event row per scene change, Clips when a Take's speech ends. Idempotent, so an
 * event replayed after a restart changes nothing it already changed.
 *
 * Scene events and Clip bounds are both in picture time; speech arrives in
 * mic time and is moved to picture time (+ mic offset) before a Clip is cut
 * or its scene looked up (recorder-service/protocol.ts, TIME BASE).
 */

/** The picture's frame rate: the CVM recorder records the screen at 60 fps. */
export const CVM_RECORDER_FPS = 60;

export type IngestResult = {
  /** The Video the event is about; null when it means nothing to an editor. */
  videoId: string | null;
  messages: CvmRecorderMessage[];
  /** The Clips saved where an editor said (`AskEditor`): its answer. */
  placed?: PlacedTake;
  /** The Recording Session was refused: nothing of it is saved. */
  refused?: boolean;
};

/**
 * Asks the editors open on a Video where to save a Recording Session's
 * speech that just ended (telling them `speech-ended`). Null: no editor
 * answered.
 */
export type AskEditor = (
  videoId: string,
  recordingSessionId: string,
  /** The Take's Clip, in picture time: told with `speech-ended`. */
  clip: ClipSpan
) => Promise<InsertionPoint | null>;

/** Asking an editor where failed: the speech is saved anyway. */
class NoEditorAnswerError extends Data.TaggedError("NoEditorAnswerError")<{
  readonly cause: unknown;
}> {}

const nothing: IngestResult = { videoId: null, messages: [] };

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
  askEditor: AskEditor
) {
  const recordingSessionId = event.recordingSessionId;
  if (event.type === "recording-started") {
    // Stored relative to its Storage Root (`raw-footage/<session>/mic.mkv`),
    // as every path is (ADR 0040); a folder under no root as it is.
    const roots = yield* storageRootsConfig;
    // A Recording Session hangs off its Video, so the Video's Version must
    // be the Draft (docs/DRAFT_GUARD.md). Refused, it is never saved, and
    // nor is anything after it: the editor is told, not retried.
    const refused = yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* requireDraftVersionForVideo(tx, event.videoId);
        // It starts with its pair's Mic Offset, fixed from here on: a later
        // AV Calibration never changes it (only Mic Settings does).
        const micOffsetMs =
          (event.devices ? yield* pairMicOffsetMs(tx, event.devices) : null) ??
          DEFAULT_MIC_OFFSET_MS;
        yield* dbCall(() =>
          tx
            .insert(recordingSessions)
            .values({
              id: recordingSessionId,
              videoId: event.videoId,
              cameraFilePath: toRootRelative(event.files.camera, roots),
              screenFilePath: toRootRelative(event.files.screen, roots),
              micFilePath: toRootRelative(event.files.mic, roots),
              micOffsetMs,
              status: "recording",
              startedAt: new Date(event.t0Ms),
              silenceLength: event.silenceLength,
              format: event.format ?? "landscape",
              screenCaptured: event.screenCaptured ?? true,
              avCalibrationId: event.avCalibrationId ?? null,
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
        refused: true,
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
    case "warmed-up":
      return {
        videoId,
        messages: [{ type: "warmed-up", recordingSessionId }],
      } satisfies IngestResult;
    case "speech-started":
      return {
        videoId,
        messages: [{ type: "speech-started", recordingSessionId }],
      } satisfies IngestResult;
    case "take-started":
      return {
        videoId,
        messages: [
          {
            type: "take-started",
            recordingSessionId,
            takeId: `${recordingSessionId}:${event.seq}`,
            // Its speech's start, in picture time: where its Clip begins.
            startTime: event.startFileTime + session.micOffsetMs / 1000,
          },
        ],
      } satisfies IngestResult;
    case "speech-ended": {
      // Speech is heard in mic file time; Clips are cut in the picture's,
      // which the mic runs ahead of by its offset.
      const offset = session.micOffsetMs / 1000;
      const speech = {
        startTime: event.startFileTime + offset,
        endTime: event.fileTime + offset,
      };
      // The span its Clip is cut to, told for the frames-lost alert (#2227).
      const [clip] = speechToClipBounds([speech], CVM_RECORDER_FPS);
      // Not a Take (no `take-started` came for it, by the same rule,
      // `isLongEnoughForClip`): no Clip, so no editor is asked where.
      if (!clip)
        return {
          videoId,
          messages: [{ type: "speech-ended", recordingSessionId }],
        } satisfies IngestResult;
      // Asked only for speech not saved yet (a replay saves nothing twice).
      let asked = false;
      let answered = false;
      const whereTo = Effect.tryPromise({
        try: () => {
          asked = true;
          return askEditor(videoId, recordingSessionId, clip);
        },
        catch: (cause) => new NoEditorAnswerError({ cause }),
      }).pipe(
        // No answer, however it failed: saved after the Video's last item.
        Effect.orElseSucceed(() => null),
        Effect.flatMap((point) => {
          answered = point !== null;
          return point ? Effect.succeed(point) : endOfVideo(db, videoId);
        })
      );
      const placed = yield* placeSpeechAsClips(db, {
        videoId,
        footagePath: session.micFilePath,
        insertionPoint: whereTo,
        fps: CVM_RECORDER_FPS,
        speech: [speech],
        recordingSession: {
          id: recordingSessionId,
          scene: yield* sceneAt(db, recordingSessionId, speech.startTime),
        },
      });
      // Asking told the editors already.
      const messages: CvmRecorderMessage[] = asked
        ? []
        : [{ type: "speech-ended", recordingSessionId, clip }];
      if (placed.clips.length === 0 || !placed.transcriptionJobId)
        return { videoId, messages } satisfies IngestResult;
      const recordingSession = yield* dbCall(() =>
        db.query.recordingSessions.findFirst({
          where: eq(recordingSessions.id, recordingSessionId),
          ...clipRecordingSessionRelation,
        })
      );
      const take: PlacedTake = {
        clips: placed.clips.map((c) => ({
          ...c,
          id: c.id as DatabaseId,
          recordingSession: recordingSession!,
        })),
        transcriptionJobId: placed.transcriptionJobId,
      };
      if (answered) return { videoId, messages, placed: take };
      messages.push({
        type: "clips-saved",
        recordingSessionId,
        clips: take.clips,
        transcriptionJobId: placed.transcriptionJobId,
      });
      return { videoId, messages } satisfies IngestResult;
    }
    case "camera-lost":
      return {
        videoId,
        messages: [
          { type: "camera-lost", recordingSessionId, errors: event.errors },
        ],
      } satisfies IngestResult;
    case "frames-lost":
      // Told at once; `recording-stopped` stores the totals.
      return {
        videoId,
        messages: [
          {
            type: "frames-lost",
            recordingSessionId,
            framesLost: { camera: event.camera, screen: event.screen },
            lostFrameSpans: event.lostFrameSpans ?? [],
          },
        ],
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
            lostFrameSpans: event.lostFrameSpans ?? null,
          },
        ],
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
            lostFrameSpans: null,
          },
        ],
      } satisfies IngestResult;
  }
});

/**
 * The Recording Sessions not yet seen to stop or crash: rows still
 * recording, and any of `candidates` with no row at all.
 */
export const unfinishedRecordingSessions = Effect.fn(
  "unfinishedRecordingSessions"
)(function* (db: Database, candidates: readonly string[] = []) {
  const rows = yield* dbCall(() =>
    db.query.recordingSessions.findMany({
      columns: { id: true, status: true },
      where: or(
        eq(recordingSessions.status, "recording"),
        candidates.length > 0
          ? inArray(recordingSessions.id, [...candidates])
          : undefined
      ),
    })
  );
  const known = new Set(rows.map((r) => r.id));
  return [
    ...rows.filter((r) => r.status === "recording").map((r) => r.id),
    ...candidates.filter((id) => !known.has(id)),
  ];
});
