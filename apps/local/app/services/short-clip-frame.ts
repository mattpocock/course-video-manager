import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import {
  resolveVideoFormat,
  VIDEO_FORMAT_DIMENSIONS,
} from "@/features/videos/video-format";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { removeBestEffort } from "@/services/remove-best-effort";
import {
  clipSegmentFrameArgs,
  needsClipSegments,
  segmentFrameCount,
} from "./clip-segment-args";
import { clipExportDurationInSeconds } from "./export-duration-check";
import { assertUnderEffect } from "./assert-under";
import {
  FRAMES_DIRECTORY,
  FrameRefusedError,
  newFramePath,
  requireTimeWithin,
  runFrameFfmpeg,
} from "./frame-stills";
import { ShortOverlayRendererService } from "./short-overlay-renderer";
import {
  shortOverlayProps,
  shortRenderClips,
  type ShortRenderClip,
} from "./short-render-clips";
import { StillGate } from "./still-gate";
import { storageRootsConfig } from "./storage-roots";
import { SHORT_OVERLAY_COMPOSITE_FILTER } from "./vertical-overlay-props";

/**
 * `cvm clip frame`: a Short's Clip as its post shows it `at` seconds in — its
 * Layers, then its captions and Chat Cards over them — as a 1080x1920 PNG.
 *
 * Nothing here draws. The picture is the Clip's own export segment graph
 * (`clipSegmentFrameArgs`), the overlay one frame of the vertical render's
 * own Remotion composition (`ShortOverlayRendererService.renderFrame`) with
 * the same props (`shortOverlayProps`), joined by the render's own overlay
 * filter. The frames line up as the render's do: the picture is frame `n` of
 * the Clip's segment, the overlay frame `n` past where the Clip starts on the
 * Short's timeline.
 *
 * The whole of it is behind the Still Gate: it reads raw footage.
 */

const FPS = 60;

/** Where the Clip at `index` starts on the Short's timeline, in frames. */
const startFrameOf = (
  renderClips: ReadonlyArray<ShortRenderClip>,
  index: number
): number => {
  const before = renderClips.slice(0, index).map(clipExportDurationInSeconds);
  // Segments are joined by stream copy, each a whole number of frames.
  if (needsClipSegments(renderClips)) {
    return before.reduce((sum, d) => sum + segmentFrameCount(d), 0);
  }
  return Math.round(before.reduce((sum, d) => sum + d, 0) * FPS);
};

export const shortClipFrame = (clipId: string, at: number) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const videoOps = yield* VideoOperationsService;
    const gate = yield* StillGate;
    const overlayRenderer = yield* ShortOverlayRendererService;
    const fs = yield* FileSystem.FileSystem;

    const [row] = yield* clipOps.getClipsByIds([clipId]);
    const video = yield* videoOps.getVideoWithClipsById(row!.videoId);
    if (resolveVideoFormat(video.format) !== "short") {
      return yield* new FrameRefusedError({
        message: `cvm clip frame draws a Short's Clips, and this Clip is on a Landscape Video (${video.id}). A Landscape Video's frame (its Definition Cards and Bullet Panels) is drawn by the course export, not here yet.`,
      });
    }
    const index = video.clips.findIndex((clip) => clip.id === clipId);
    const storageRoots = yield* storageRootsConfig;

    return yield* gate.run(
      Effect.gen(function* () {
        // Its files found on a Storage Root, as the render finds them.
        const renderClips = yield* shortRenderClips(video.clips, storageRoots);
        const clip = renderClips[index]!;
        const duration = clipExportDurationInSeconds(clip);
        yield* requireTimeWithin(at, duration, "Clip");
        const frame = Math.min(
          Math.floor(at * FPS + 1e-6),
          segmentFrameCount(duration) - 1
        );
        const props = yield* shortOverlayProps({
          renderClips,
          clips: video.clips,
          fps: FPS,
        });
        const overlayFrame = Math.min(
          startFrameOf(renderClips, index) + frame,
          props.durationInFrames - 1
        );

        // Scratch, removed once drawn; only the composed frame is kept.
        const picture = yield* assertUnderEffect(
          FRAMES_DIRECTORY,
          yield* newFramePath("clip-picture")
        );
        const overlay = yield* assertUnderEffect(
          FRAMES_DIRECTORY,
          yield* newFramePath("clip-overlay")
        );
        const output = yield* newFramePath("clip");
        yield* runFrameFfmpeg(
          clipSegmentFrameArgs(
            { ...clip, duration },
            VIDEO_FORMAT_DIMENSIONS.short,
            frame,
            picture
          ),
          `Clip ${clipId}'s picture at ${at}s`
        );
        yield* overlayRenderer.renderFrame(props, overlayFrame, overlay);
        yield* runFrameFfmpeg(
          [
            "-y",
            "-hide_banner",
            "-v",
            "error",
            "-i",
            picture,
            "-i",
            overlay,
            "-filter_complex",
            SHORT_OVERLAY_COMPOSITE_FILTER,
            "-map",
            "[outv]",
            "-frames:v",
            "1",
            output,
          ],
          `Clip ${clipId}'s overlay at ${at}s`
        );
        yield* removeBestEffort(fs, picture);
        yield* removeBestEffort(fs, overlay);
        return output;
      })
    );
  });
