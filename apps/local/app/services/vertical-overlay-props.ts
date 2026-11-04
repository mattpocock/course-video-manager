import { callToActionInputProps } from "@/features/video-editor/call-to-action-input-props";
import { chatCardInputProps } from "@/features/video-editor/chat-card-input-props";
import type { CallToAction } from "@cvm/overlay-renderer/props";
import type { LayerRect } from "@cvm/core/features/videos/clip-layer";
import { Data } from "effect";
import {
  resolveOverlayKind,
  type OverlayKind,
} from "@/features/videos/overlay-kind";
import {
  clipExportDurationInSeconds,
  type ExportClipDuration,
} from "./export-duration-check";
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
 * frame by frame from the domain, which the renderer cannot import, and is
 * put in the slot clear of the Face Areas (`clipFaceAreas`) of every Clip it
 * is drawn over; a Call to Action carries its words and its Animation Toggles.
 *
 * Throws {@link ChatCardCoversFaceError} when a Chat Card has no slot clear
 * of them: it is never drawn over Matt's face (#2669).
 */
export const verticalOverlayProps = (p: {
  fps: number;
  durationInFrames: number;
  subtitles: Subtitle[];
  clips: ShortClips;
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

/**
 * A Short's Clips, in order: their Overlays, and where Matt's face can be in
 * their picture (`clipFaceAreas`), in Short pixels.
 */
type ShortClips = ReadonlyArray<{
  overlays: ReadonlyArray<ExportOverlay>;
  faceAreas: ReadonlyArray<LayerRect>;
}>;

/**
 * A Chat Card that cannot be drawn clear of Matt's face: both its slots meet
 * the Face Area of a Clip it is drawn over. The render and `cvm clip frame`
 * refuse rather than draw it there.
 */
export class ChatCardCoversFaceError extends Data.TaggedError(
  "ChatCardCoversFaceError"
)<{ readonly message: string }> {}

/** The Face Areas of every Clip a span of the Short's timeline is drawn over. */
const faceAreasUnder = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  startInSeconds: number,
  endInSeconds: number
): LayerRect[] => {
  let clipStart = 0;
  return clips.flatMap((clip, index) => {
    const duration = clipDurations[index];
    const from = clipStart;
    clipStart += duration ? clipExportDurationInSeconds(duration) : 0;
    return from < endInSeconds && clipStart > startInSeconds
      ? [...clip.faceAreas]
      : [];
  });
};

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
      return {
        overlay,
        startFrame,
        durationInFrames,
        startInSeconds,
        endInSeconds,
      };
    });

/** A Short's Chat Cards, in frames on its timeline. */
const chatCardProps = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number
) =>
  placeInFrames(clips, clipDurations, fps, "chatCard").map(
    ({
      overlay,
      startFrame,
      durationInFrames,
      startInSeconds,
      endInSeconds,
    }) => {
      const card = chatCardInputProps(
        overlay,
        { startFrame, durationInFrames, fps },
        faceAreasUnder(clips, clipDurations, startInSeconds, endInSeconds)
      );
      if (card === null) {
        throw new ChatCardCoversFaceError({
          message:
            `The Chat Card "${overlay.title}" at ${startInSeconds.toFixed(2)}s ` +
            "would cover Matt's face: the Clips under it leave neither its " +
            "top nor its bottom slot clear. Move or shorten it so it runs " +
            "over Clips with the face in one half of the frame, or change " +
            "their camera Layers.",
        });
      }
      return card;
    }
  );

/** A Short's Calls to Action, in frames on its timeline. */
const callToActionProps = (
  clips: ShortClips,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number
): CallToAction[] =>
  placeInFrames(clips, clipDurations, fps, "callToAction").map(
    ({ overlay, startFrame, durationInFrames }) =>
      callToActionInputProps(overlay, { startFrame, durationInFrames })
  );
