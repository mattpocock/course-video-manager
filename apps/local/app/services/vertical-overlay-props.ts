import { chatCardInputProps } from "@/features/video-editor/chat-card-input-props";
import type { CallToAction } from "@cvm/overlay-renderer/props";
import {
  resolveOverlayKind,
  type OverlayKind,
} from "@/features/videos/overlay-kind";
import type { ExportClipDuration } from "./export-duration-check";
import type { ExportOverlay } from "./export-hash";
import { placeOnTimeline } from "./overlay-timeline";

/**
 * How a Short's overlay is drawn over its picture: by the render's final pass
 * (`compositeOverlay`) and by `cvm clip frame`, alike.
 */
export const SHORT_OVERLAY_COMPOSITE_FILTER =
  "[0:v][1:v]overlay=0:0:format=auto[outv]";

/** A caption segment, timed in frames, as `loadShortSubtitles` builds it. */
type Subtitle = { startFrame: number; endFrame: number; text: string };

/**
 * The props a Short's render hands its one Remotion composition: the
 * captions, the Short's Chat Cards and its Calls to Action. Pure, so what a
 * Short draws is tested without a render. The render, `cvm clip frame` and the
 * Portrait Studio's paused frame all draw from these props.
 *
 * Chat Cards and Calls to Action are the only Overlays a Short draws. Each is
 * placed with the export's own placement (`placeOnTimeline`), on the same Clip
 * durations the concat and the captions use. A Chat Card carries its motion
 * frame by frame from the domain's Chat Spin, which the renderer cannot
 * import; a Call to Action carries its words and its Animation Toggles.
 */
export const verticalOverlayProps = (p: {
  fps: number;
  durationInFrames: number;
  subtitles: Subtitle[];
  clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>;
  clipDurations: ReadonlyArray<ExportClipDuration>;
}) => ({
  width: 1080,
  height: 1920,
  fps: p.fps,
  durationInFrames: p.durationInFrames,
  subtitles: p.subtitles,
  chatCards: chatCardProps(p.clips, p.clipDurations, p.fps),
  callsToAction: callToActionProps(p.clips, p.clipDurations, p.fps),
});

type ShortClips = ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>;

/** A Short's Overlays of one Kind, in frames on its timeline. */
const placeInFrames = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number,
  kind: OverlayKind
) =>
  placeOnTimeline(clips, clipDurations)
    .filter(({ overlay }) => resolveOverlayKind(overlay.kind) === kind)
    .map(({ overlay, startInSeconds, endInSeconds }) => {
      const startFrame = Math.round(startInSeconds * fps);
      const durationInFrames = Math.max(
        1,
        Math.round(endInSeconds * fps) - startFrame
      );
      return { overlay, startFrame, durationInFrames };
    });

/** A Short's Chat Cards, in frames on its timeline. */
const chatCardProps = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number
) =>
  placeInFrames(clips, clipDurations, fps, "chatCard").map(
    ({ overlay, startFrame, durationInFrames }) =>
      chatCardInputProps(overlay, { startFrame, durationInFrames, fps })
  );

/** A Short's Calls to Action, in frames on its timeline. */
const callToActionProps = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number
): CallToAction[] =>
  placeInFrames(clips, clipDurations, fps, "callToAction").map(
    ({ overlay, startFrame, durationInFrames }) => ({
      title: overlay.title,
      description: overlay.description,
      startFrame,
      durationInFrames,
      disableEnterAnimation: overlay.disableEnterAnimation,
      disableExitAnimation: overlay.disableExitAnimation,
    })
  );
