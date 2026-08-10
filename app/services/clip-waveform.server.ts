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
  text: string;
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

export interface WaveformContextWindow {
  file: string;
  startTime: number;
  duration: number;
}

/**
 * Computes the seek window for a join-context sliver: the last
 * `contextSeconds` of the PREVIOUS clip's source range ("tail", shown dimmed
 * at the start of a row's waveform) or the first `contextSeconds` of the
 * NEXT clip's source range ("head", shown dimmed at the end), so each row
 * can show both cuts around it without cross-referencing another row.
 *
 * Returns `null` when there's nothing to show: no neighbor (first clip has
 * no tail, last clip has no head), a degenerate (non-positive-duration)
 * neighbor, or `contextSeconds <= 0`. Never throws — every input here can
 * legitimately happen at a real clip-list boundary.
 *
 * A neighbor SHORTER than `contextSeconds` is clamped to its own full
 * duration rather than reading past its bounds (which would either error at
 * the source file's edge or, worse, silently read into whatever audio
 * happens to follow it in that source file — not this neighbor's own
 * audio).
 */
export function computeContextWindow(
  neighbor:
    | Pick<
        WaveformSourceClip,
        "videoFilename" | "sourceStartTime" | "sourceEndTime"
      >
    | undefined,
  contextSeconds: number,
  side: "tail" | "head"
): WaveformContextWindow | null {
  if (!neighbor) return null;

  const neighborDuration = Math.max(
    0,
    neighbor.sourceEndTime - neighbor.sourceStartTime
  );
  const duration = Math.min(Math.max(0, contextSeconds), neighborDuration);
  if (duration <= 0) return null;

  const startTime =
    side === "tail"
      ? neighbor.sourceEndTime - duration
      : neighbor.sourceStartTime;

  return { file: neighbor.videoFilename, startTime, duration };
}

export interface WaveformOptions {
  /** Horizontal zoom level: rendered pixels per second of audio. */
  pxPerSecond: number;
  /** Rendered waveform image height, in pixels. */
  height: number;
  /**
   * How much of the adjacent clip's audio to show, dimmed, at each end of a
   * row's waveform — the previous clip's tail at the start, the next clip's
   * head at the end — so a join artifact is visible without cross-referencing
   * another row. Matt's ask was "the first five seconds", hence the default.
   */
  contextSeconds: number;
  /**
   * Gain in dB applied before rendering (ffmpeg `volume=<N>dB`), on top of
   * `showwavespic`'s own `scale=cbrt` display remap (see
   * `generateWaveformPng`'s doc comment in `ffmpeg-commands.ts`).
   *
   * Exposed as a per-video knob, not hardcoded, because measured against a
   * range of test tones (-45dBFS through -1dBFS true peak): the default
   * `scale=lin` `showwavespic` mapping renders a typical quiet
   * talking-head recording (peaking well below 0dBFS — see
   * `SILENCE_THRESHOLD_DB` in `silence-detection-constants.ts`, a -38dB
   * *silence* floor, meaning normal speech sits somewhere above that but
   * still nowhere near 0dBFS) as 1-7% of the image height — exactly Matt's
   * "too quiet to detect anything" report. `scale=cbrt` alone helps
   * (~15-39% for -45..-20dBFS) but source gain varies clip to clip
   * (different mics/gain staging), so a single fixed multiplier can't be
   * simultaneously enough for a quiet clip and safe (non-clipping) for a
   * loud one — hence a caller-supplied knob rather than a baked-in
   * constant. +12dB was chosen as the default because at that level a
   * -20dBFS clip (a plausible quiet-talking-head peak) renders at ~63% of
   * image height, while true near-0dBFS content still renders at ~90-97%
   * (not pinned flat at 100%, so louder passages stay visually
   * distinguishable from each other) and true digital silence stays
   * silent regardless of gain (0 × anything is still 0).
   */
  gainDb: number;
}

const DEFAULT_WAVEFORM_OPTIONS: WaveformOptions = {
  pxPerSecond: 40,
  height: 64,
  contextSeconds: 5,
  gainDb: 12,
};

const MIN_PX_PER_SECOND = 2;
const MAX_PX_PER_SECOND = 400;
const MIN_HEIGHT = 16;
const MAX_HEIGHT = 400;
const MIN_CONTEXT_SECONDS = 0;
const MAX_CONTEXT_SECONDS = 30;
const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 48;

/**
 * Sanitizes the render knobs off a (possibly untrusted, straight off a
 * JSON request body) action payload: falls back to the default for
 * anything missing/non-finite/wrongly-typed, then clamps into a sane
 * range so a stray huge/negative/zero value can't make ffmpeg spend
 * forever (or error) rendering a degenerate image, or apply a gain wild
 * enough to be pointless.
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
    contextSeconds: clamp(
      finite(input?.contextSeconds) ?? DEFAULT_WAVEFORM_OPTIONS.contextSeconds,
      MIN_CONTEXT_SECONDS,
      MAX_CONTEXT_SECONDS
    ),
    gainDb: clamp(
      finite(input?.gainDb) ?? DEFAULT_WAVEFORM_OPTIONS.gainDb,
      MIN_GAIN_DB,
      MAX_GAIN_DB
    ),
  };
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface WaveformContextImage {
  durationSeconds: number;
  widthPx: number;
  imageDataUrl: string;
}

export interface WaveformClip {
  clipId: string;
  order: number;
  videoStartSeconds: number;
  durationSeconds: number;
  text: string;
  widthPx: number;
  imageDataUrl: string;
  /** Dimmed tail of the PREVIOUS clip, rendered at the start of the row. `null` for the first clip, or when `contextSeconds` is 0. */
  leadIn: WaveformContextImage | null;
  /** Dimmed head of the NEXT clip, rendered at the end of the row. `null` for the last clip, or when `contextSeconds` is 0. */
  leadOut: WaveformContextImage | null;
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

      const toDataUrl = (png: Buffer) =>
        `data:image/png;base64,${png.toString("base64")}`;

      const renderContextImage = Effect.fn("renderContextImage")(function* (
        window: WaveformContextWindow,
        options: WaveformOptions
      ) {
        const widthPx = Math.max(
          1,
          Math.round(window.duration * options.pxPerSecond)
        );
        const png = yield* ffmpeg.generateWaveformPng(window.file, {
          startTime: window.startTime,
          duration: window.duration,
          width: widthPx,
          height: options.height,
          gainDb: options.gainDb,
        });
        return {
          durationSeconds: window.duration,
          widthPx,
          imageDataUrl: toDataUrl(png),
        } satisfies WaveformContextImage;
      });

      /**
       * Renders one row: the clip's own waveform plus, on each side, a
       * dimmed sliver of the adjacent clip's audio so a bad cut is visible
       * without cross-referencing another row (see `computeContextWindow`).
       * All three images (main + up to 2 context) are rendered concurrently
       * — each individually goes through `FFmpegCommandsService`'s own
       * `cpuSemaphore`, which already caps total concurrent ffmpeg
       * processes across the whole app, so nesting concurrency here just
       * queues rather than over-spawning.
       */
      const renderClipRow = Effect.fn("renderClipRow")(function* (
        clip: WaveformSourceClip,
        order: number,
        videoStartSeconds: number,
        durationSeconds: number,
        prevClip: WaveformSourceClip | undefined,
        nextClip: WaveformSourceClip | undefined,
        options: WaveformOptions
      ) {
        const widthPx = Math.max(
          1,
          Math.round(durationSeconds * options.pxPerSecond)
        );
        const leadInWindow = computeContextWindow(
          prevClip,
          options.contextSeconds,
          "tail"
        );
        const leadOutWindow = computeContextWindow(
          nextClip,
          options.contextSeconds,
          "head"
        );

        const [mainPng, leadIn, leadOut] = yield* Effect.all(
          [
            ffmpeg.generateWaveformPng(clip.videoFilename, {
              startTime: clip.sourceStartTime,
              duration: durationSeconds,
              width: widthPx,
              height: options.height,
              gainDb: options.gainDb,
            }),
            leadInWindow
              ? renderContextImage(leadInWindow, options)
              : Effect.succeed(null),
            leadOutWindow
              ? renderContextImage(leadOutWindow, options)
              : Effect.succeed(null),
          ],
          { concurrency: 3 }
        );

        return {
          clipId: clip.id,
          order,
          videoStartSeconds,
          durationSeconds,
          text: clip.text,
          widthPx,
          imageDataUrl: toDataUrl(mainPng),
          leadIn,
          leadOut,
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
          text: c.text,
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
              : renderClipRow(
                  clip,
                  order,
                  videoStartSeconds,
                  durationSeconds,
                  order > 0 ? clips[order - 1] : undefined,
                  order < clips.length - 1 ? clips[order + 1] : undefined,
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
