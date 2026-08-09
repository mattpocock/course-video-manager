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

// ─── Tunable options (starting-point defaults — the UI lets Matt override
// these per run instead of editing code; see DEFAULT_PROOFREAD_OPTIONS) ─────

export interface ProofreadOptions {
  /** dB floor below which audio counts as silence. Same default the live auto-editor uses. */
  silenceThresholdDb: number;
  /** A pause at least this long is flagged as "long-pause". Defaults to the existing long-silence-length constant. */
  longPauseMinSeconds: number;
  /**
   * A gap at least this long is flagged as "short-cutout". Deliberately NOT
   * defaulted to the `SILENCE_LENGTH_SHORT_SECONDS` (0.8s) floor from
   * `silence-detection-constants.ts` — that constant is tuned for live
   * auto-editing cut points, not for catching a brief mid-sentence audio
   * dropout, which is what "(5:39) The audio cuts out very briefly" describes.
   */
  shortCutoutMinSeconds: number;
  /** How much of each clip's source range to pull for the boundary check, on either side of the join. */
  joinWindowSeconds: number;
  /** How close a detected silence period has to sit to the exact join point to count as a boundary artifact. */
  joinToleranceSeconds: number;
}

export const DEFAULT_PROOFREAD_OPTIONS: ProofreadOptions = {
  silenceThresholdDb: SILENCE_THRESHOLD_DB,
  longPauseMinSeconds: SILENCE_LENGTH_LONG_SECONDS,
  shortCutoutMinSeconds: 0.15,
  joinWindowSeconds: 1,
  joinToleranceSeconds: 0.2,
};

/**
 * Merges a (possibly partial, possibly untrusted — e.g. straight off a JSON
 * request body) set of overrides onto the defaults. Non-finite/non-number
 * values fall back to the default rather than erroring, since this is a
 * throwaway prototype form, not a validated API. Duration-like fields are
 * clamped to zero; `silenceThresholdDb` is left alone since negative values
 * are the normal case.
 */
export function sanitizeProofreadOptions(
  input?: Partial<Record<keyof ProofreadOptions, unknown>> | null
): ProofreadOptions {
  const finite = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const merged: ProofreadOptions = {
    silenceThresholdDb:
      finite(input?.silenceThresholdDb) ??
      DEFAULT_PROOFREAD_OPTIONS.silenceThresholdDb,
    longPauseMinSeconds:
      finite(input?.longPauseMinSeconds) ??
      DEFAULT_PROOFREAD_OPTIONS.longPauseMinSeconds,
    shortCutoutMinSeconds:
      finite(input?.shortCutoutMinSeconds) ??
      DEFAULT_PROOFREAD_OPTIONS.shortCutoutMinSeconds,
    joinWindowSeconds:
      finite(input?.joinWindowSeconds) ??
      DEFAULT_PROOFREAD_OPTIONS.joinWindowSeconds,
    joinToleranceSeconds:
      finite(input?.joinToleranceSeconds) ??
      DEFAULT_PROOFREAD_OPTIONS.joinToleranceSeconds,
  };

  return {
    ...merged,
    longPauseMinSeconds: Math.max(0, merged.longPauseMinSeconds),
    shortCutoutMinSeconds: Math.max(0, merged.shortCutoutMinSeconds),
    joinWindowSeconds: Math.max(0, merged.joinWindowSeconds),
    joinToleranceSeconds: Math.max(0, merged.joinToleranceSeconds),
  };
}

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

/**
 * Turns a clip's two raw `silencedetect` passes (long-pause floor, then
 * short-cutout floor) into report spans. The single option this reads is
 * `longPauseMinSeconds` — it's what decides whether a period surviving the
 * short-cutout pass is actually a duplicate of a long pause (see
 * `excludeLongPeriods`). The thresholds fed to ffmpeg to produce `longRaw`
 * and `shortRaw` in the first place are the service's job, not this
 * function's — see `proofreadPerClipSpans` below.
 */
export function classifyPerClipSpans(
  longRaw: string,
  shortRaw: string,
  clip: Pick<ProofreadClip, "id" | "sourceStartTime" | "sourceEndTime">,
  videoStartSeconds: number,
  options: Pick<ProofreadOptions, "longPauseMinSeconds">
): ProofreadSpan[] {
  const longPeriods = absoluteSilencePeriodsWithinClip(longRaw, clip);
  const shortPeriods = excludeLongPeriods(
    absoluteSilencePeriodsWithinClip(shortRaw, clip),
    options.longPauseMinSeconds
  );

  return [
    ...spansFromPeriods(longPeriods, clip, videoStartSeconds, "long-pause"),
    ...spansFromPeriods(shortPeriods, clip, videoStartSeconds, "short-cutout"),
  ];
}

/**
 * Turns a stitched join window's raw `silencedetect` output into `boundary`
 * spans, filtering to periods that actually sit at the join
 * (`toleranceSeconds`) rather than being incidental silence inside either
 * clip's own trimmed second.
 */
export function classifyBoundarySpan(
  rawOutput: string,
  joinPointSeconds: number,
  clipB: Pick<ProofreadClip, "id">,
  clipBVideoStartSeconds: number,
  toleranceSeconds: number
): ProofreadSpan[] {
  const periods = parseSilencePeriods(rawOutput);
  const hits = findJoinHits(periods, joinPointSeconds, toleranceSeconds);

  return hits.map((hit): ProofreadSpan => ({
    type: "boundary",
    videoTimestampSeconds: round2(clipBVideoStartSeconds),
    clipId: clipB.id,
    clipRelativeOffsetSeconds: 0,
    durationSeconds: round2(Math.max(0, hit.end - hit.start)),
  }));
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
        function* (
          clip: ProofreadClip,
          videoStartSeconds: number,
          options: ProofreadOptions
        ) {
          const [longRaw, shortRaw] = yield* Effect.all(
            [
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: options.silenceThresholdDb,
                silenceDuration: options.longPauseMinSeconds,
                startTime: clip.sourceStartTime,
              }),
              ffmpeg.detectSilence(clip.videoFilename, {
                threshold: options.silenceThresholdDb,
                silenceDuration: options.shortCutoutMinSeconds,
                startTime: clip.sourceStartTime,
              }),
            ],
            { concurrency: 2 }
          );

          return classifyPerClipSpans(
            longRaw,
            shortRaw,
            clip,
            videoStartSeconds,
            options
          );
        }
      );

      const proofreadBoundary = Effect.fn("proofreadBoundary")(function* (
        clipA: ProofreadClip,
        clipB: ProofreadClip,
        clipBVideoStartSeconds: number,
        options: ProofreadOptions
      ) {
        const { segmentA, segmentB, joinPointSeconds } = computeJoinWindow(
          clipA,
          clipB,
          options.joinWindowSeconds
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
            threshold: options.silenceThresholdDb,
            silenceDuration: options.shortCutoutMinSeconds,
          }
        );

        return classifyBoundarySpan(
          rawOutput,
          joinPointSeconds,
          clipB,
          clipBVideoStartSeconds,
          options.joinToleranceSeconds
        );
      });

      const proofreadVideo = Effect.fn("proofreadVideo")(function* (
        videoId: string,
        overrides?: Partial<Record<keyof ProofreadOptions, unknown>> | null
      ) {
        const options = sanitizeProofreadOptions(overrides);

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
            proofreadPerClipSpans(
              clip,
              videoStartByClipId.get(clip.id)!,
              options
            ),
          { concurrency: 4 }
        );

        const boundarySpans = yield* Effect.forEach(
          consecutivePairs(clips),
          ([clipA, clipB]) =>
            proofreadBoundary(
              clipA,
              clipB,
              videoStartByClipId.get(clipB.id)!,
              options
            ),
          { concurrency: 4 }
        );

        const spans = [...perClipSpans.flat(), ...boundarySpans.flat()].sort(
          (a, b) => a.videoTimestampSeconds - b.videoTimestampSeconds
        );

        return {
          videoId: video.id,
          title: video.title,
          totalDurationSeconds: round2(totalDurationSeconds),
          options,
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
