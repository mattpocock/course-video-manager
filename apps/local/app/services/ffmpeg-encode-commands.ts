import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import {
  BITEXACT_ARGS,
  GPU_DECODE_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  SHORTS_BURN_IN_ENCODE_ARGS,
  FFmpegError,
  type FfmpegLogInfo,
} from "./ffmpeg-error";
import { runFfmpegWithProgress } from "./ffmpeg-run";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import { SidecarContext } from "./sidecar-context";
import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { clipExportDurationInSeconds } from "./export-duration-check";
import { makeConcatenateClipSegments } from "./ffmpeg-encode-segments";
import {
  buildOverlayCompositeArgs,
  type RenderedOverlay,
} from "./overlay-compositing";

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
        clips: readonly {
          inputVideo: string;
          startTime: number;
          duration: number;
          pauseType: "none" | "long";
          zoomType?: string;
        }[],
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

        // Build input args. The summed -t values are also the expected output
        // duration (the concat filter output is exactly the clips end to end),
        // which anchors the progress percentage.
        const inputArgs: string[] = [];
        let expectedOutputDuration = 0;
        for (const clip of clips) {
          const duration = clipExportDurationInSeconds(clip);
          expectedOutputDuration += duration;
          inputArgs.push(
            "-ss",
            clip.startTime.toString(),
            "-t",
            duration.toString(),
            "-i",
            clip.inputVideo
          );
        }

        // Build filter complex. Normalize every input to the target frame (and
        // stereo audio) so the concat filter — which requires all inputs to
        // share dimensions/SAR/channel layout — accepts odd effect clips (e.g.
        // white noise at 854x480 mono). The target dimensions come from the
        // video's format: portrait 1080x1920 for shorts (whose 9:16 subtitle
        // overlay must line up), landscape 1920x1080 otherwise. Passing the
        // wrong dimensions here is what previously forced every export portrait.
        //
        // A Clip Zoom's crop goes BEFORE that scale, so a source larger than
        // the output frame is cropped and then scaled DOWN — the zoom spends
        // surplus resolution rather than upscaling. Cropping after the scale
        // would discard those pixels first and stretch what remained. The crop
        // string comes from clipZoomCropFilter, the same rect the editor
        // preview's CSS transform is formatted from.
        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        for (let i = 0; i < clips.length; i++) {
          const cropFilter = clipZoomCropFilter(clips[i]!.zoomType);
          filterParts.push(
            `[${i}:v]setpts=PTS-STARTPTS,${
              cropFilter ? `${cropFilter},` : ""
            }scale=${dimensions.width}:${dimensions.height},setsar=1[v${i}]`,
            `[${i}:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[a${i}]`
          );
          concatInputs.push(`[v${i}][a${i}]`);
        }
        filterParts.push(
          `${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[outv][outa]`
        );

        const filterComplex = filterParts.join(";");

        const args = [
          "-y",
          "-hide_banner",
          ...inputArgs,
          "-filter_complex",
          filterComplex,
          "-map",
          "[outv]",
          "-map",
          "[outa]",
          ...LANDSCAPE_VIDEO_ENCODE_ARGS,
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-b:a",
          "320k",
          "-async",
          "1",
          "-movflags",
          "+faststart",
          ...BITEXACT_ARGS,
          outputFile,
        ];

        yield* runEncode({
          args,
          totalDurationSeconds: expectedOutputDuration,
          onProgress: extras.onProgress,
          onLog: extras.onLog,
          errorPrefix: "Failed to create concatenated video",
        });

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
       * A Short's final pass: its subtitle/CTA overlay (a Remotion ProRes 4444
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
          "[0:v][1:v]overlay=0:0:format=auto[outv]",
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

      return {
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
