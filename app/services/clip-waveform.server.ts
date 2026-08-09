/**
 * PROTOTYPE service backing `app/routes/prototype.waveform.tsx`.
 *
 * Replaces the earlier audio-proofread prototype (ffmpeg `silencedetect`
 * thresholds flagging candidate pauses/dropouts/joins) after Matt's
 * feedback that a thresholded detector is worse than just looking at a
 * waveform himself. This service does no detection at all — it renders a
 * PNG waveform image per clip (via `FFmpegCommandsService.generateWaveformPng`)
 * so a human can eyeball a rendered lesson's audio directly, with the clip
 * boundaries marked so a click/level-jump at a join is easy to spot by eye.
 *
 * No auto-fix, no publish-gating: this only produces images for a UI.
 */

import { Effect } from "effect";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { VideoOperationsService } from "./db-video-operations.server";

// ─── Pure helpers (unit-tested in clip-waveform.test.ts) ───────────────────

export interface WaveformSourceClip {
  id: string;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
}

/**
 * Walks the ordered, non-archived clip list and sums `sourceEndTime -
 * sourceStartTime` per clip to get each clip's start offset in the final
 * rendered (concatenated) video — the same offset the exporter's concat
 * produces. Ignores render-time padding (`LONG_PAUSE_DURATION` /
 * `FINAL_VIDEO_PADDING` in `course-publish-service.ts` /
 * `batch-export.server.ts`): a few hundred ms of drift is acceptable noise
 * for a throwaway prototype whose whole point is a human looking at the
 * picture, not a frame-exact measurement.
 *
 * A clip with a non-positive duration (bad/degenerate `sourceStartTime` >=
 * `sourceEndTime`) is clamped to zero rather than allowed to push later
 * clips backwards.
 */
export function computeClipOffsets(clips: readonly WaveformSourceClip[]): {
  clipId: string;
  videoStartSeconds: number;
  durationSeconds: number;
}[] {
  let cumulative = 0;
  return clips.map((clip) => {
    const durationSeconds = Math.max(
      0,
      clip.sourceEndTime - clip.sourceStartTime
    );
    const videoStartSeconds = cumulative;
    cumulative += durationSeconds;
    return { clipId: clip.id, videoStartSeconds, durationSeconds };
  });
}

export interface WaveformOptions {
  /** Horizontal zoom level: rendered pixels per second of audio. */
  pxPerSecond: number;
  /** Rendered waveform image height, in pixels. */
  height: number;
}

const DEFAULT_WAVEFORM_OPTIONS: WaveformOptions = {
  pxPerSecond: 40,
  height: 64,
};

const MIN_PX_PER_SECOND = 2;
const MAX_PX_PER_SECOND = 400;
const MIN_HEIGHT = 16;
const MAX_HEIGHT = 400;

/**
 * Sanitizes the two render knobs off a (possibly untrusted, straight off a
 * JSON request body) action payload: falls back to the default for
 * anything missing/non-finite/wrongly-typed, then clamps into a sane
 * positive range so a stray huge/negative/zero value can't make ffmpeg spend
 * forever (or error) rendering a degenerate image.
 */
export function sanitizeWaveformOptions(
  input?: Partial<Record<keyof WaveformOptions, unknown>> | null
): WaveformOptions {
  const finite = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  return {
    pxPerSecond: clamp(
      finite(input?.pxPerSecond) ?? DEFAULT_WAVEFORM_OPTIONS.pxPerSecond,
      MIN_PX_PER_SECOND,
      MAX_PX_PER_SECOND
    ),
    height: clamp(
      finite(input?.height) ?? DEFAULT_WAVEFORM_OPTIONS.height,
      MIN_HEIGHT,
      MAX_HEIGHT
    ),
  };
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface WaveformClip {
  clipId: string;
  order: number;
  videoStartSeconds: number;
  durationSeconds: number;
  widthPx: number;
  imageDataUrl: string;
}

export interface WaveformResult {
  videoId: string;
  title: string;
  totalDurationSeconds: number;
  clips: WaveformClip[];
}

// ─── Service ─────────────────────────────────────────────────────────────

export class ClipWaveformService extends Effect.Service<ClipWaveformService>()(
  "ClipWaveformService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const ffmpeg = yield* FFmpegCommandsService;

      const renderClipWaveform = Effect.fn("renderClipWaveform")(function* (
        clip: WaveformSourceClip,
        order: number,
        videoStartSeconds: number,
        durationSeconds: number,
        options: WaveformOptions
      ) {
        const widthPx = Math.max(
          1,
          Math.round(durationSeconds * options.pxPerSecond)
        );

        const png = yield* ffmpeg.generateWaveformPng(clip.videoFilename, {
          startTime: clip.sourceStartTime,
          duration: durationSeconds,
          width: widthPx,
          height: options.height,
        });

        return {
          clipId: clip.id,
          order,
          videoStartSeconds,
          durationSeconds,
          widthPx,
          imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
        } satisfies WaveformClip;
      });

      const getWaveforms = Effect.fn("getWaveforms")(function* (
        videoId: string,
        options: WaveformOptions
      ) {
        const video = yield* videoOps.getVideoWithClipsById(videoId);
        const clips: WaveformSourceClip[] = video.clips.map((c) => ({
          id: c.id,
          videoFilename: c.videoFilename,
          sourceStartTime: c.sourceStartTime,
          sourceEndTime: c.sourceEndTime,
        }));

        const offsets = computeClipOffsets(clips);
        const totalDurationSeconds = offsets.reduce(
          (acc, o) => acc + o.durationSeconds,
          0
        );

        const rendered = yield* Effect.forEach(
          clips.map((clip, order) => ({ clip, order, ...offsets[order]! })),
          ({ clip, order, videoStartSeconds, durationSeconds }) =>
            durationSeconds <= 0
              ? Effect.succeed(null)
              : renderClipWaveform(
                  clip,
                  order,
                  videoStartSeconds,
                  durationSeconds,
                  options
                ),
          { concurrency: 4 }
        );

        return {
          videoId: video.id,
          title: video.title,
          totalDurationSeconds,
          clips: rendered.filter((c): c is WaveformClip => c !== null),
        } satisfies WaveformResult;
      });

      return { getWaveforms };
    }),
    dependencies: [
      VideoOperationsService.Default,
      FFmpegCommandsService.Default,
    ],
  }
) {}
