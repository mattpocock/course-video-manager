/**
 * Speech to Clips: the source-agnostic half of recording. Whoever finds the
 * speech (the CVM recorder's silence detector), this decides what of it
 * becomes a Clip and where the Clips go.
 *
 * What of the speech becomes a Clip is `speechToClipBounds`, the same rule
 * `findSilenceInVideo` bounds a Footage file's speech with (old OBS Footage,
 * Footage transcription), so one speech gives the same Clip either way.
 *
 * Speech from a Recording Session is placed once: a speech whose Clip that
 * Recording Session already has (archived or not) is skipped, so a replay of
 * the recorder's events never duplicates a Clip.
 */

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { clips as clipsTable } from "@/db/schema";
import type { RecordingSessionScene } from "@cvm/core/features/videos/recorder";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";
import type { Database } from "@/services/drizzle-service.server";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";
import type { InsertionPoint } from "./clip-service";
import type { UnknownDBServiceError } from "@/services/db-service-errors";
import {
  dbCall,
  placeClips,
  withVideoMutex,
} from "./clip-service-handler.helpers";
import { speechToClipBounds, type SpeechSegment } from "./silence-detection";

export type { SpeechSegment };

export interface PlaceSpeechAsClipsInput {
  readonly videoId: string;
  /** The Footage file the speech was found in: each Clip's Footage path. */
  readonly footagePath: string;
  /**
   * Where the Clips go, resolved to saved Clips and chapters; or how to
   * find out, asked only when there is speech not saved yet.
   */
  readonly insertionPoint:
    InsertionPoint | Effect.Effect<InsertionPoint, UnknownDBServiceError>;
  /** The picture's frame rate: Clip bounds snap to its frames. */
  readonly fps: number;
  readonly speech: readonly SpeechSegment[];
  /**
   * The Recording Session the speech was recorded in, and the scene in force
   * at its start: set on each Clip, and the key a replayed speech is
   * recognised by. Null for speech from a single Footage file.
   */
  readonly recordingSession: {
    readonly id: string;
    readonly scene: RecordingSessionScene;
  } | null;
}

/** Bounds within this of a saved Clip's are the same speech, replayed. */
const SAME_BOUND_SECONDS = 0.005;

/**
 * Save speech as Clips at the editor's insertion point and enqueue one
 * `transcribe-clips` Job for them. Runs under the video's mutex, so speech
 * arriving at once from two places never takes the same order key.
 */
export const placeSpeechAsClips = Effect.fn("placeSpeechAsClips")(function* (
  db: Database,
  input: PlaceSpeechAsClipsInput
) {
  const bounds = speechToClipBounds(input.speech, input.fps);
  const session = input.recordingSession;

  const clips = yield* withVideoMutex(
    input.videoId,
    Effect.gen(function* () {
      const placed = session
        ? yield* dbCall(() =>
            db.query.clips.findMany({
              where: and(
                eq(clipsTable.videoId, input.videoId),
                eq(clipsTable.recordingSessionId, session.id)
              ),
            })
          )
        : [];
      const fresh = bounds.filter(
        (b) =>
          !placed.some(
            (c) =>
              Math.abs(c.sourceStartTime - b.startTime) < SAME_BOUND_SECONDS &&
              Math.abs(c.sourceEndTime - b.endTime) < SAME_BOUND_SECONDS
          )
      );
      if (fresh.length === 0) return [];
      const insertionPoint = Effect.isEffect(input.insertionPoint)
        ? yield* input.insertionPoint
        : input.insertionPoint;
      return yield* placeClips(db, {
        videoId: input.videoId,
        insertionPoint,
        clips: fresh.map((b) => ({
          inputVideo: input.footagePath,
          ...b,
          recordingSessionId: session?.id ?? null,
          scene: session?.scene ?? null,
        })),
      });
    })
  );
  if (clips.length === 0) {
    return { clips: [], transcriptionJobId: null };
  }

  const clipIds = clips.map((c) => c.id);
  const job = yield* enqueueJob({
    id: null,
    kind: TRANSCRIBE_CLIPS_JOB_KIND,
    title: `Transcribe ${clipIds.length} ${clipIds.length === 1 ? "Clip" : "Clips"}`,
    params: { clipIds },
    subject: { type: "video", id: input.videoId },
    attemptsSpent: 0,
    dependsOn: null,
    registry: JOB_KIND_SPECS,
  });

  return { clips, transcriptionJobId: job.id };
});
