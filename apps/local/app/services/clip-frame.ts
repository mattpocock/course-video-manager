import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import {
  resolveVideoFormat,
  VIDEO_FORMAT_DIMENSIONS,
} from "@/features/videos/video-format";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { NotFoundError } from "@/services/db-service-errors";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { removeBestEffort } from "@/services/remove-best-effort";
import type { StorageRoots } from "@/packages/storage";
import {
  clipSegmentFrameArgs,
  needsClipSegments,
  segmentFrameCount,
  type SegmentClip,
} from "./clip-segment-args";
import {
  clipExportDurationInSeconds,
  paddedClipDurationsInSeconds,
  type ExportClipDuration,
} from "./export-duration-check";
import { exportRenderClips } from "./export-render-clips";
import { assertUnderEffect } from "./assert-under";
import {
  FRAMES_DIRECTORY,
  newFramePath,
  requireTimeWithin,
  runFrameFfmpeg,
} from "./frame-stills";
import { OverlayFrameService } from "./overlay-frame";
import { overlayRenderProps } from "./overlay-content-props";
import {
  buildOverlayCompositeFrameFilterGraph,
  overlayOnScreenAt,
  placeOverlaysOnTimeline,
} from "./overlay-compositing";
import { shortOverlayProps, shortRenderClips } from "./short-render-clips";
import { StillGate } from "./still-gate";
import { EXPORT_FPS, exportFrameAt } from "@/packages/clip-source";
import { storageRootsConfig } from "./storage-roots";
import { SHORT_OVERLAY_COMPOSITE_FILTER } from "./vertical-overlay-props";

/**
 * `cvm clip frame`: a Clip as its Video's render shows it `at` seconds in, as
 * a PNG at the Video's size. One service for both Video Formats:
 *
 * - a **Short**: its Layers, then its captions and Chat Cards over them, as
 *   the vertical render posts it (1080x1920);
 * - a **Landscape** Video: its Layers, slid by the Transform of the Overlay
 *   on screen then, with that Definition Card or Bullet Panel over them, as
 *   the course export ships it (1920x1080). No captions, no Chat Cards: the
 *   course export draws neither.
 *
 * Nothing here draws. The picture is frame `n` of the Clip's own export
 * segment graph (`clipSegmentFrameArgs`); the overlay is one frame of the
 * render's own Remotion composition (`OverlayFrameService.renderFrame`) with
 * the props the render uses, joined by the render's own filter. The frames
 * line up as the render's do: the picture is frame `n` of the Clip's segment,
 * the overlay the frame on screen `n` frames past where the Clip starts on
 * the Video's timeline.
 *
 * The whole of it is behind the Still Gate: it reads raw footage.
 */

const FPS = EXPORT_FPS;

/** Where the Clip at `index` starts on the Video's timeline, in frames. */
const startFrameOf = (
  renderClips: ReadonlyArray<
    Pick<SegmentClip, "composite" | "layers"> & ExportClipDuration
  >,
  index: number
): number => {
  const before = renderClips.slice(0, index).map(clipExportDurationInSeconds);
  // Segments are joined by stream copy, each a whole number of frames.
  if (needsClipSegments(renderClips)) {
    return before.reduce((sum, d) => sum + segmentFrameCount(d), 0);
  }
  return Math.round(before.reduce((sum, d) => sum + d, 0) * FPS);
};

/** The frame of a Clip's segment showing `at` seconds in. */
const clipFrameAt = (at: number, duration: number) =>
  Effect.gen(function* () {
    yield* requireTimeWithin(at, duration, "Clip");
    return Math.min(exportFrameAt(at), segmentFrameCount(duration) - 1);
  });

/** A scratch PNG, removed once `use` is done with it (or failed). */
const withScratchPng = <A, E, R>(
  name: string,
  use: (path: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* assertUnderEffect(
      FRAMES_DIRECTORY,
      yield* newFramePath(name)
    );
    return yield* use(scratch).pipe(
      Effect.ensuring(removeBestEffort(fs, scratch))
    );
  });

/** The Clip's picture: frame `frame` of its export segment, at `dims`. */
const drawPicture = (
  clipId: string,
  at: number,
  clip: SegmentClip,
  dims: { readonly width: number; readonly height: number },
  frame: number,
  output: string
) =>
  runFrameFfmpeg(
    clipSegmentFrameArgs(clip, dims, frame, output),
    `Clip ${clipId}'s picture at ${at}s`
  );

/** Joins `inputs` through `filter` (ending in `[outv]`) into one PNG. */
const joinFrame = (
  inputs: readonly string[],
  filter: string,
  output: string,
  what: string
) =>
  runFrameFfmpeg(
    [
      "-y",
      "-hide_banner",
      "-v",
      "error",
      ...inputs.flatMap((input) => ["-i", input]),
      "-filter_complex",
      filter,
      "-map",
      "[outv]",
      "-frames:v",
      "1",
      output,
    ],
    what
  );

type VideoWithClips = Effect.Effect.Success<
  ReturnType<VideoOperationsService["getVideoWithClipsById"]>
>;

type FrameRequest = {
  readonly clipId: string;
  readonly at: number;
  readonly video: VideoWithClips;
  readonly index: number;
  readonly storageRoots: StorageRoots;
};

/** A Short's Clip, as `cvm short render` posts it. */
const shortFrame = ({ clipId, at, video, index, storageRoots }: FrameRequest) =>
  Effect.gen(function* () {
    const overlayRenderer = yield* OverlayFrameService;
    // Its files found on a Storage Root, as the render finds them.
    const renderClips = yield* shortRenderClips(video.clips, storageRoots);
    const clip = renderClips[index]!;
    const duration = clipExportDurationInSeconds(clip);
    const frame = yield* clipFrameAt(at, duration);
    const props = yield* shortOverlayProps({
      renderClips,
      clips: video.clips,
      fps: FPS,
    });
    const overlayFrame = Math.min(
      startFrameOf(renderClips, index) + frame,
      props.durationInFrames - 1
    );

    // Scratch, removed once drawn (or failed); only the composed frame is kept.
    return yield* withScratchPng("clip-picture", (picture) =>
      withScratchPng("clip-overlay", (overlay) =>
        Effect.gen(function* () {
          const output = yield* newFramePath("clip");
          yield* drawPicture(
            clipId,
            at,
            { ...clip, duration },
            VIDEO_FORMAT_DIMENSIONS.short,
            frame,
            picture
          );
          yield* overlayRenderer.renderFrame(props, overlayFrame, overlay);
          yield* joinFrame(
            [picture, overlay],
            SHORT_OVERLAY_COMPOSITE_FILTER,
            output,
            `Clip ${clipId}'s overlay at ${at}s`
          );
          return output;
        })
      )
    );
  });

/**
 * A Landscape Video's Clip, as the course export ships it. With no Overlay on
 * screen it is one ffmpeg run, and the overlay renderer is never started.
 */
const landscapeFrame = ({
  clipId,
  at,
  video,
  index,
  storageRoots,
}: FrameRequest) =>
  Effect.gen(function* () {
    // The seconds the export asks each Clip for (the last one padded), and
    // its files found as the export finds them.
    const clipDurations = paddedClipDurationsInSeconds(video.clips);
    const renderClips = yield* exportRenderClips(video.clips, {
      videoFormat: "landscape",
      storageRoots,
      clipDurations,
    });
    const clip = renderClips[index]!;
    const duration = clipExportDurationInSeconds(clip);
    const frame = yield* clipFrameAt(at, duration);
    const dims = VIDEO_FORMAT_DIMENSIONS.landscape;
    const timelineFrame = startFrameOf(renderClips, index) + frame;
    const onScreen = overlayOnScreenAt(
      placeOverlaysOnTimeline(video.clips, clipDurations),
      timelineFrame / FPS
    );

    const output = yield* newFramePath("clip");
    const segment = { ...clip, duration };
    if (!onScreen) {
      yield* drawPicture(clipId, at, segment, dims, frame, output);
      return output;
    }

    return yield* withScratchPng("clip-picture", (picture) =>
      Effect.gen(function* () {
        yield* drawPicture(clipId, at, segment, dims, frame, picture);
        const what = `Clip ${clipId}'s Overlay at ${at}s`;
        const { overlay, contentFrame } = onScreen;
        if (contentFrame === null) {
          // Inside its window but none of its render on screen: the move only.
          yield* joinFrame(
            [picture],
            buildOverlayCompositeFrameFilterGraph(
              overlay,
              timelineFrame,
              false
            ),
            output,
            what
          );
          return output;
        }
        const overlayRenderer = yield* OverlayFrameService;
        return yield* withScratchPng("clip-overlay", (content) =>
          Effect.gen(function* () {
            yield* overlayRenderer.renderFrame(
              overlayRenderProps(overlay.content),
              contentFrame,
              content
            );
            yield* joinFrame(
              [picture, content],
              buildOverlayCompositeFrameFilterGraph(
                overlay,
                timelineFrame,
                true
              ),
              output,
              what
            );
            return output;
          })
        );
      })
    );
  });

export const clipFrame = (clipId: string, at: number) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const videoOps = yield* VideoOperationsService;
    const gate = yield* StillGate;

    const [row] = yield* clipOps.getClipsByIds([clipId]);
    if (!row || row.archived) {
      return yield* new NotFoundError({
        type: "clipFrame",
        params: { clipId },
      });
    }
    const video = yield* videoOps.getVideoWithClipsById(row.videoId);
    const request: FrameRequest = {
      clipId,
      at,
      video,
      index: video.clips.findIndex((clip) => clip.id === clipId),
      storageRoots: yield* storageRootsConfig,
    };

    return yield* gate.run(
      resolveVideoFormat(video.format) === "short"
        ? shortFrame(request)
        : landscapeFrame(request)
    );
  });
