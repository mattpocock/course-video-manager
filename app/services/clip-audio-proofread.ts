/**
 * PROTOTYPE service backing `app/routes/prototype.audio-proofread.tsx`.
 *
 * Purpose: sanity-check whether ffmpeg silence-detection can flag the kind of
 * editing problems a human catches by ear in a rendered lesson — a pause that
 * runs long, a brief audio dropout, a click/level-jump right at a clip join —
 * so Matt can eyeball the results before anyone invests in a real feature.
 * No auto-fix, no publish-gating: this only produces a flat report.
 *
 * All the threshold constants below are rough first guesses, not tuned
 * against real footage — see the PR description for how to retune them.
 *
 * Deliberately ignores the render-time padding `course-publish-service.ts` /
 * `batch-export.server.ts` add (`LONG_PAUSE_DURATION` = 0.18s between a
 * `pauseType: "long"` clip and the next, `FINAL_VIDEO_PADDING` = 0.42s on the
 * very last clip). Matt's feedback timestamps are eyeballed by ear ("1:30"),
 * not frame-exact, so a few hundred ms of drift near a `long` pause or at the
 * very end of the video is acceptable noise for a throwaway prototype.
 */

import { Effect } from "effect";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { VideoOperationsService } from "./db-video-operations.server";
import { parseSilencePeriods } from "./silence-detection";
import {
  SILENCE_THRESHOLD_DB,
  SILENCE_LENGTH_LONG_SECONDS,
} from "@/silence-detection-constants";

// ─── Tunable constants (starting points — retune against real footage) ─────

/** Same dB floor the live auto-editor uses; audio below this counts as silence. */
export const PROOFREAD_SILENCE_THRESHOLD_DB = SILENCE_THRESHOLD_DB;

/** A pause at least this long is flagged as "long-pause" — reuses the existing long-silence-length constant. */
export const LONG_PAUSE_MIN_SECONDS = SILENCE_LENGTH_LONG_SECONDS;

/**
 * A gap at least this long is flagged as "short-cutout". Deliberately NOT the
 * `SILENCE_LENGTH_SHORT_SECONDS` (0.8s) floor from `silence-detection-constants.ts`
 * — that constant is tuned for live auto-editing cut points, not for catching
 * a brief mid-sentence audio dropout, which is what "(5:39) The audio cuts
 * out very briefly" describes.
 */
export const SHORT_CUTOUT_MIN_SECONDS = 0.15;

/** How much of each clip's source range to pull for the boundary check, on either side of the join. */
export const JOIN_WINDOW_SECONDS = 1;

/** How close a detected silence period has to sit to the exact join point to count as a boundary artifact. */
export const JOIN_TOLERANCE_SECONDS = 0.2;

// ─── Types ───────────────────────────────────────────────────────────────

export type ProofreadSpanType = "long-pause" | "short-cutout" | "boundary";

export interface ProofreadSpan {
  type: ProofreadSpanType;
  videoTimestampSeconds: number;
  clipId: string;
  clipRelativeOffsetSeconds: number;
  durationSeconds: number;
}

export interface ProofreadClip {
  id: string;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
}

// ─── Pure helpers (unit-tested in clip-audio-proofread.test.ts) ────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Walks the ordered, non-archived clip list and sums `sourceEndTime -
 * sourceStartTime` per clip to get each clip's start offset in the final
 * rendered (concatenated) video. Ignores render-time padding — see the
 * module doc comment.
 */
export function computeClipVideoOffsets(
  clips: readonly ProofreadClip[]
): { clipId: string; videoStartSeconds: number; durationSeconds: number }[] {
  let cumulative = 0;
  return clips.map((clip) => {
    const durationSeconds = clip.sourceEndTime - clip.sourceStartTime;
    const videoStartSeconds = cumulative;
    cumulative += durationSeconds;
    return { clipId: clip.id, videoStartSeconds, durationSeconds };
  });
}

/**
 * Converts raw `silencedetect` output from a single-clip pass (ffmpeg seeked
 * to `clip.sourceStartTime`, no end bound) into silence periods expressed in
 * the SOURCE FILE's absolute timeline, clamped to `clip.sourceEndTime` —
 * `detectSilence` only supports a start offset, so anything past the clip's
 * own end has to be filtered out here (the same "add the seek offset back"
 * trick `findSilenceInVideo` already uses to get absolute file positions).
 */
export function absoluteSilencePeriodsWithinClip(
  rawOutput: string,
  clip: Pick<ProofreadClip, "sourceStartTime" | "sourceEndTime">
): { start: number; end: number }[] {
  const periods = parseSilencePeriods(rawOutput);

  return (
    periods
      .map((p) => ({
        start: p.start + clip.sourceStartTime,
        end: p.end + clip.sourceStartTime,
      }))
      // A period starting at/after the clip's own end belongs to whatever
      // comes after it in the source file, not to this clip.
      .filter((p) => p.start < clip.sourceEndTime)
      .map((p) => ({
        start: p.start,
        end: Math.min(p.end, clip.sourceEndTime),
      }))
  );
}

/**
 * The short-cutout pass runs at a much lower duration floor than the
 * long-pause pass, so it re-detects every long pause too (ffmpeg's `d=`
 * option is a minimum, not a band). Filters those back out so a single pause
 * isn't reported twice under two types.
 */
export function excludeLongPeriods(
  periods: { start: number; end: number }[],
  longPauseMinSeconds: number
): { start: number; end: number }[] {
  return periods.filter((p) => p.end - p.start < longPauseMinSeconds);
}

/**
 * Maps clip-local silence periods (already in source-absolute coordinates)
 * to report spans with video-relative timestamps.
 */
export function spansFromPeriods(
  periods: { start: number; end: number }[],
  clip: Pick<ProofreadClip, "id" | "sourceStartTime">,
  videoStartSeconds: number,
  type: Extract<ProofreadSpanType, "long-pause" | "short-cutout">
): ProofreadSpan[] {
  return periods.map((p) => {
    const clipRelativeOffsetSeconds = round2(p.start - clip.sourceStartTime);
    return {
      type,
      videoTimestampSeconds: round2(
        videoStartSeconds + clipRelativeOffsetSeconds
      ),
      clipId: clip.id,
      clipRelativeOffsetSeconds,
      durationSeconds: round2(p.end - p.start),
    };
  });
}

/**
 * Computes the two trimmed segments to pull for a clip-to-clip boundary
 * check — the last `windowSeconds` of clip A's source range and the first
 * `windowSeconds` of clip B's source range (each clamped to the clip's own
 * bounds, since a clip can be shorter than the window) — plus where the join
 * itself lands once those two segments are stitched back to back.
 */
export function computeJoinWindow(
  clipA: Pick<
    ProofreadClip,
    "videoFilename" | "sourceStartTime" | "sourceEndTime"
  >,
  clipB: Pick<
    ProofreadClip,
    "videoFilename" | "sourceStartTime" | "sourceEndTime"
  >,
  windowSeconds: number
): {
  segmentA: { file: string; seekSeconds: number; durationSeconds: number };
  segmentB: { file: string; seekSeconds: number; durationSeconds: number };
  joinPointSeconds: number;
} {
  const aSeek = Math.max(
    clipA.sourceStartTime,
    clipA.sourceEndTime - windowSeconds
  );
  const aDuration = Math.max(0, clipA.sourceEndTime - aSeek);
  const bDuration = Math.max(
    0,
    Math.min(windowSeconds, clipB.sourceEndTime - clipB.sourceStartTime)
  );

  return {
    segmentA: {
      file: clipA.videoFilename,
      seekSeconds: aSeek,
      durationSeconds: aDuration,
    },
    segmentB: {
      file: clipB.videoFilename,
      seekSeconds: clipB.sourceStartTime,
      durationSeconds: bDuration,
    },
    joinPointSeconds: aDuration,
  };
}

/**
 * Of the silence periods detected in a stitched join window, keeps only the
 * ones that actually straddle (or sit within `toleranceSeconds` of) the exact
 * join point — a pause fully inside clip A's or clip B's own trimmed second
 * is not a join artifact, it's just that clip's own audio.
 */
export function findJoinHits(
  periods: { start: number; end: number }[],
  joinPointSeconds: number,
  toleranceSeconds: number
): { start: number; end: number }[] {
  return periods.filter(
    (p) =>
      p.start - toleranceSeconds <= joinPointSeconds &&
      p.end + toleranceSeconds >= joinPointSeconds
  );
}

function consecutivePairs<T>(items: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length - 1; i++) {
    pairs.push([items[i]!, items[i + 1]!]);
  }
  return pairs;
}

// ─── Service ─────────────────────────────────────────────────────────────

export class ClipAudioProofreadService extends Effect.Service<ClipAudioProofreadService>()(
  "ClipAudioProofreadService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;

      const proofreadPerClipSpans = Effect.fn("proofreadPerClipSpans")(
        function* (clip: ProofreadClip, videoStartSeconds: number) {
          const [longRaw, shortRaw] = yield* Effect.all(
            [
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: PROOFREAD_SILENCE_THRESHOLD_DB,
                silenceDuration: LONG_PAUSE_MIN_SECONDS,
                startTime: clip.sourceStartTime,
              }),
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: PROOFREAD_SILENCE_THRESHOLD_DB,
                silenceDuration: SHORT_CUTOUT_MIN_SECONDS,
                startTime: clip.sourceStartTime,
              }),
            ],
            { concurrency: 2 }
          );

          const longPeriods = absoluteSilencePeriodsWithinClip(longRaw, clip);
          const shortPeriods = excludeLongPeriods(
            absoluteSilencePeriodsWithinClip(shortRaw, clip),
            LONG_PAUSE_MIN_SECONDS
          );

          return [
            ...spansFromPeriods(
              longPeriods,
              clip,
              videoStartSeconds,
              "long-pause"
            ),
            ...spansFromPeriods(
              shortPeriods,
              clip,
              videoStartSeconds,
              "short-cutout"
            ),
          ];
        }
      );

      const proofreadBoundary = Effect.fn("proofreadBoundary")(function* (
        clipA: ProofreadClip,
        clipB: ProofreadClip,
        clipBVideoStartSeconds: number
      ) {
        const { segmentA, segmentB, joinPointSeconds } = computeJoinWindow(
          clipA,
          clipB,
          JOIN_WINDOW_SECONDS
        );

        if (segmentA.durationSeconds <= 0 || segmentB.durationSeconds <= 0) {
          return [];
        }

        const rawOutput = yield* ffmpeg.detectSilenceAcrossJoin(
          {
            file: segmentA.file,
            startTime: segmentA.seekSeconds,
            duration: segmentA.durationSeconds,
          },
          {
            file: segmentB.file,
            startTime: segmentB.seekSeconds,
            duration: segmentB.durationSeconds,
          },
          {
            threshold: PROOFREAD_SILENCE_THRESHOLD_DB,
            silenceDuration: SHORT_CUTOUT_MIN_SECONDS,
          }
        );

        const periods = parseSilencePeriods(rawOutput);
        const hits = findJoinHits(
          periods,
          joinPointSeconds,
          JOIN_TOLERANCE_SECONDS
        );

        return hits.map((hit): ProofreadSpan => ({
          type: "boundary",
          videoTimestampSeconds: round2(clipBVideoStartSeconds),
          clipId: clipB.id,
          clipRelativeOffsetSeconds: 0,
          durationSeconds: round2(Math.max(0, hit.end - hit.start)),
        }));
      });

      const proofreadVideo = Effect.fn("proofreadVideo")(function* (
        videoId: string
      ) {
        const video = yield* videoOps.getVideoWithClipsById(videoId);
        const clips: ProofreadClip[] = video.clips.map((c) => ({
          id: c.id,
          videoFilename: c.videoFilename,
          sourceStartTime: c.sourceStartTime,
          sourceEndTime: c.sourceEndTime,
        }));

        const offsets = computeClipVideoOffsets(clips);
        const videoStartByClipId = new Map(
          offsets.map((o) => [o.clipId, o.videoStartSeconds])
        );
        const totalDurationSeconds = offsets.reduce(
          (acc, o) => acc + o.durationSeconds,
          0
        );

        const perClipSpans = yield* Effect.forEach(
          clips,
          (clip) =>
            proofreadPerClipSpans(clip, videoStartByClipId.get(clip.id)!),
          { concurrency: 4 }
        );

        const boundarySpans = yield* Effect.forEach(
          consecutivePairs(clips),
          ([clipA, clipB]) =>
            proofreadBoundary(clipA, clipB, videoStartByClipId.get(clipB.id)!),
          { concurrency: 4 }
        );

        const spans = [...perClipSpans.flat(), ...boundarySpans.flat()].sort(
          (a, b) => a.videoTimestampSeconds - b.videoTimestampSeconds
        );

        return {
          videoId: video.id,
          title: video.title,
          totalDurationSeconds: round2(totalDurationSeconds),
          spans,
        };
      });

      return { proofreadVideo };
    }),
    dependencies: [
      VideoOperationsService.Default,
      FFmpegCommandsService.Default,
    ],
  }
) {}
