import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import {
  BITEXACT_ARGS,
  GPU_DECODE_ARGS,
  SHORTS_BURN_IN_ENCODE_ARGS,
  FFmpegError,
  FfmpegInputCutShortError,
  withClipIndex,
  type FfmpegLogInfo,
} from "./ffmpeg-error";
import { runFfmpegWithProgress } from "./ffmpeg-run";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import { SidecarContext } from "./sidecar-context";
import { buildClipConcatArgs, type ConcatClip } from "./clip-concat-args";
import { makeConcatenateClipSegments } from "./ffmpeg-encode-segments";
import { SHORT_OVERLAY_COMPOSITE_FILTER } from "./vertical-overlay-props";
import { assertUnder } from "./assert-under";
import { buildOverlayCompositeArgs } from "./overlay-composite-args";
import type { RenderedOverlay } from "./overlay-compositing";
import {
  animaticEncodeDurationSeconds,
  buildAnimaticEncodeArgs,
  type AnimaticEncodeSegment,
} from "./animatic-encode-args";

/**
 * The ffmpeg ENCODES: concatenating a Video's Clips, normalizing its audio,
 * and compositing Overlays — the passes of a course export and of a vertical
 * Short. Each is minutes of GPU work someone walks away from, so each runs in
 * the **Sidecar** (docs/plans/background-jobs-sidecar.md): they ask for
 * `SidecarContext`, and only the Sidecar's layer (`sidecar/sidecar-layer.ts`)
 * builds this service. The quick, interactive ffmpeg calls a page waits on —
 * a probe, a frame, silence detection — stay in `FFmpegCommandsService`.
 */
export class FFmpegEncodeService extends Effect.Service<FFmpegEncodeService>()(
  "FFmpegEncodeService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // Built once per process; every encode below draws its slot from it,
      // through `runFfmpegWithProgress`.
      const permits = yield* FfmpegPermitsService;
      type RunOptions = Omit<
        Parameters<typeof runFfmpegWithProgress>[0],
        "permit"
      >;
      const runEncode = (opts: RunOptions) =>
        runFfmpegWithProgress({ ...opts, permit: "encode-slot" }).pipe(
          Effect.provideService(FfmpegPermitsService, permits)
        );
      // A pass that stream-copies the video: a CPU permit, not an encode slot.
      const runCopyPass = (opts: RunOptions) =>
        runFfmpegWithProgress({ ...opts, permit: "cpu-permit" }).pipe(
          Effect.provideService(FfmpegPermitsService, permits)
        );

      const createAndConcatenateVideoClipsSinglePass = Effect.fn(
        "createAndConcatenateVideoClipsSinglePass"
      )(function* (
        clips: readonly ConcatClip[],
        dimensions: { width: number; height: number },
        // A single required object rather than stacking positional optionals:
        // onProgress may reasonably be skipped (progress reporting is a UI
        // nicety), but onLog must not be — an omitted logger silently drops
        // the per-video log this function exists to feed. See the "optional
        // parameters" note in CODING_STANDARDS.md.
        extras: {
          onProgress?: (percent: number) => void;
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(clips) + Date.now())
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp4`);

        const { args, expectedOutputDuration } = buildClipConcatArgs({
          clips,
          dimensions,
          outputFile,
        });

        yield* runEncode({
          args,
          totalDurationSeconds: expectedOutputDuration,
          onProgress: extras.onProgress,
          onLog: extras.onLog,
          errorPrefix: "Failed to create concatenated video",
        }).pipe(
          // One input per Clip, in order, so ffmpeg's input number IS the
          // Clip's position in the Video.
          Effect.mapError((error) =>
            error instanceof FfmpegInputCutShortError
              ? withClipIndex(error, error.inputIndex)
              : error
          ),
          // A pass that failed leaves no half-written file in the temp dir.
          Effect.tapError(() => {
            const partialOutput = assertUnder(outputDir, outputFile);
            return fs.remove(partialOutput).pipe(Effect.ignore);
          })
        );

        return outputFile;
      });

      const normalizeAudio = Effect.fn("normalizeAudio")(function* (
        inputVideo: string,
        extras: {
          onProgress?: (percent: number) => void;
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(inputVideo + "-normalized-" + Date.now())
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp4`);

        // Get video and audio durations
        const getStreamDuration = (streamType: string) =>
          Effect.gen(function* () {
            const command = Command.make(
              "ffprobe",
              "-v",
              "error",
              "-select_streams",
              `${streamType}:0`,
              "-show_entries",
              "stream=duration",
              "-of",
              "default=noprint_wrappers=1:nokey=1",
              inputVideo
            );
            const result = yield* Command.string(command);
            return Number(result.trim());
          });

        const videoDuration = yield* getStreamDuration("v");
        const audioDuration = yield* getStreamDuration("a");

        const stretchFactor = videoDuration / audioDuration;
        const needsStretching = Math.abs(stretchFactor - 1) > 0.001; // >10ms drift

        const audioFilters: string[] = [];
        if (needsStretching) {
          audioFilters.push(`atempo=${stretchFactor}`);
        }
        audioFilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

        const args = [
          "-y",
          "-hide_banner",
          "-i",
          inputVideo,
          "-c:v",
          "copy",
          "-af",
          audioFilters.join(","),
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-b:a",
          "320k",
          ...BITEXACT_ARGS,
          outputFile,
        ];

        // Video is stream-copied (no NVENC), so it runs on a CPU permit,
        // alongside the encodes rather than in one of their slots.
        yield* runCopyPass({
          args,
          // Video is stream-copied, so the output duration is the input's.
          totalDurationSeconds: videoDuration,
          onProgress: extras.onProgress,
          onLog: extras.onLog,
          errorPrefix: "Failed to normalize audio",
        });

        return outputFile;
      });

      /**
       * A Short's final pass: its caption overlay (a Remotion ProRes 4444
       * render with alpha) burned into the concatenated video.
       *
       * The video decodes on NVDEC and encodes on NVENC
       * ({@link SHORTS_BURN_IN_ENCODE_ARGS}); with no usable GPU,
       * `runFfmpegWithProgress` re-runs it as the libx264 CRF 18 it was.
       *
       * The overlay itself stays a CPU filter. NVDEC cannot decode ProRes, and
       * `overlay_cuda` will not blend an alpha overlay onto NVDEC's NV12 frames,
       * so the GPU graph still decodes and converts the overlay on the CPU: on
       * an 8 s 1080x1920 test it saved 1.1 s of 6.7 s. Not worth a second,
       * GPU-only filter graph that the CPU fallback could not share.
       */
      const compositeOverlay = Effect.fn("compositeOverlay")(function* (
        videoPath: string,
        overlayPath: string,
        outputPath: string,
        // Required, not optional — see the note on runFfmpegWithProgress.
        onLog: (info: FfmpegLogInfo) => void
      ) {
        // A Short's composite is a Job's: only the Sidecar provides this.
        yield* SidecarContext;
        const args = [
          "-y",
          "-hide_banner",
          ...GPU_DECODE_ARGS,
          "-i",
          videoPath,
          "-i",
          overlayPath,
          "-filter_complex",
          SHORT_OVERLAY_COMPOSITE_FILTER,
          "-map",
          "[outv]",
          "-map",
          "0:a",
          ...SHORTS_BURN_IN_ENCODE_ARGS,
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          ...BITEXACT_ARGS,
          outputPath,
        ];

        yield* runEncode({
          args,
          // No progress is reported for this pass.
          totalDurationSeconds: 0,
          onProgress: undefined,
          onLog,
          errorPrefix: "Failed to composite overlay",
        });

        return outputPath;
      });

      /**
       * Composite N transparent Definition Card renders onto one video in a
       * single pass, each shown only for its own span of the timeline.
       *
       * Deliberately NOT a widening of `compositeOverlay`: that one is the
       * vertical Shorts pipeline's single, full-length subtitle track, with
       * its own encode settings. This one is the
       * landscape/course export's sparse, time-gated overlays, and it re-encodes
       * a file the concat pass has already written — so it takes its picture
       * settings from {@link LANDSCAPE_VIDEO_ENCODE_ARGS}, the same ones that
       * pass used, rather than from the Shorts burn-in it resembles. A course
       * video with a Definition Card is otherwise a second-generation CPU
       * re-encode with different characteristics from every course video
       * without one.
       *
       * The command line itself is built — and tested — by
       * {@link buildOverlayCompositeArgs}.
       */
      const compositeOverlaysAtOffsets = Effect.fn(
        "compositeOverlaysAtOffsets"
      )(function* (
        videoPath: string,
        overlays: ReadonlyArray<RenderedOverlay>,
        outputPath: string,
        extras: {
          /** What the caller's Clips ask for — the progress denominator. */
          totalDurationSeconds: number;
          onProgress?: (percent: number) => void;
          // Required, not optional — see the note on runFfmpegWithProgress.
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const args = buildOverlayCompositeArgs(videoPath, overlays, outputPath);
        if (!args) {
          // A caller with nothing to composite must skip the pass, not ask
          // for one: re-encoding a video to change none of it would move its
          // bytes for no reason.
          return yield* new FFmpegError({
            cause: null,
            message: "Cannot composite overlays: no overlays were given",
          });
        }

        yield* runEncode({
          args,
          totalDurationSeconds: extras.totalDurationSeconds,
          onProgress: extras.onProgress,
          onLog: extras.onLog,
          errorPrefix: "Failed to composite overlays",
        });

        return outputPath;
      });

      /**
       * A Video's Animatic, rendered to one file in the scratch directory:
       * every frame held for its segment with its voice over it. One encode
       * slot, NVENC, the CPU fallback — see {@link buildAnimaticEncodeArgs}.
       */
      const encodeAnimatic = Effect.fn("encodeAnimatic")(function* (
        segments: readonly AnimaticEncodeSegment[],
        dimensions: { width: number; height: number },
        extras: {
          onProgress?: (percent: number) => void;
          // Required, not optional — see the note on runFfmpegWithProgress.
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });
        const outputFile = path.join(
          outputDir,
          `${crypto.randomUUID()}.animatic.mp4`
        );

        yield* runEncode({
          args: buildAnimaticEncodeArgs({ segments, dimensions, outputFile }),
          totalDurationSeconds: animaticEncodeDurationSeconds(segments),
          onProgress: extras.onProgress,
          onLog: extras.onLog,
          errorPrefix: "Failed to encode the Animatic",
        });

        return outputFile;
      });

      return {
        encodeAnimatic,
        createAndConcatenateVideoClipsSinglePass,
        // A Video with a CVM-recorder Clip: per-Clip segments, joined by copy.
        concatenateClipSegments: makeConcatenateClipSegments({
          fs,
          runEncode,
        }),
        normalizeAudio,
        compositeOverlay,
        compositeOverlaysAtOffsets,
      };
    }),
    dependencies: [NodeContext.layer, FfmpegPermitsService.Default],
  }
) {}
