import { Effect } from "effect";
import {
  clipComposite,
  clipFfmpegInput,
  clipLayers,
  clipSource,
  type ClipSourceRow,
} from "@/packages/clip-source";
import type { StorageRoots } from "@/packages/storage";
import { clipExportDurationInSeconds } from "./export-duration-check";
import type { ExportOverlay } from "./export-hash";
import { resolveClipSourceFiles } from "./clip-source-files.server";
import { loadShortSubtitles } from "./short-subtitles";
import { verticalOverlayProps } from "./vertical-overlay-props";

/**
 * A Short's Clips as its render draws them, and the props of its one overlay
 * (captions and Chat Cards). Shared by the vertical render
 * (`render-vertical-video-service.ts`) and `cvm clip frame`
 * (`short-clip-frame.ts`), so a composed frame is drawn from the same plan as
 * the post.
 */

/** A Short's Clip row, as `getVideoWithClipsById` gives it. */
type ShortClipRow = ClipSourceRow & {
  readonly id: string;
  readonly text: string;
  readonly pauseType: string;
  readonly zoomType: string;
  readonly overlays: ReadonlyArray<ExportOverlay>;
};

/**
 * Each Clip drawn in the Short layout, its files found on a Storage Root (or
 * "Footage not found (E: offline?)"): a stream's Landscape session too,
 * never its own picture squashed.
 */
export const shortRenderClips = (
  clips: ReadonlyArray<ShortClipRow>,
  storageRoots: StorageRoots
) =>
  Effect.forEach(clips, (clip) =>
    Effect.gen(function* () {
      const source = yield* resolveClipSourceFiles(
        clipSource(clip, { videoFormat: "short" }),
        storageRoots
      );
      const input = {
        ...clipFfmpegInput(source),
        pauseType: clip.pauseType as "none" | "long",
        zoomType: clip.zoomType,
      };
      const duration = clipExportDurationInSeconds(input);
      return {
        ...input,
        id: clip.id,
        text: clip.text,
        // A CVM-recorder Clip's picture is drawn from its Recording
        // Session, over everything it outputs (long Pause included).
        composite: clipComposite(source, { durationSeconds: duration }),
        layers: clipLayers(source),
      };
    })
  );

export type ShortRenderClip = Effect.Effect.Success<
  ReturnType<typeof shortRenderClips>
>[number];

/**
 * The overlay's props: the subtitles, from the Clips' own text and Transcript
 * Words (#2172), never a second transcription, and the Chat Cards. Each Clip
 * takes the seconds the concat is asked for, so the timelines match.
 */
export const shortOverlayProps = (p: {
  readonly renderClips: ReadonlyArray<ShortRenderClip>;
  readonly clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>;
  readonly fps: number;
}) =>
  Effect.gen(function* () {
    const { subtitles, durationInFrames } = yield* loadShortSubtitles(
      p.renderClips.map((clip) => ({
        id: clip.id,
        text: clip.text,
        durationSeconds: clipExportDurationInSeconds(clip),
      })),
      p.fps
    );
    return verticalOverlayProps({
      fps: p.fps,
      durationInFrames,
      subtitles,
      clips: p.clips,
      clipDurations: p.renderClips,
    });
  });

export type ShortOverlayProps = Effect.Effect.Success<
  ReturnType<typeof shortOverlayProps>
>;
