import { CHAT_CARD_PLACEMENT } from "@cvm/overlay-renderer/props";
import { chatCardMotion } from "@cvm/core/features/videos/chat-highlight-motion";
import { resolveOverlayKind } from "@/features/videos/overlay-kind";
import type { ExportClipDuration } from "./export-duration-check";
import type { ExportOverlay } from "./export-hash";
import { placeOnTimeline } from "./overlay-compositing";

/** A caption segment, timed in frames, as `loadShortSubtitles` builds it. */
type Subtitle = { startFrame: number; endFrame: number; text: string };

/**
 * The props a Short's render hands its one Remotion composition: the
 * captions, the CTA, and the Short's Chat Cards. Pure, so what a Short draws
 * is tested without a render.
 *
 * Chat Cards are the only Overlays a Short draws. Each is placed with the
 * export's own placement (`placeOnTimeline`), on the same Clip durations the
 * concat and the captions use, and carries its motion frame by frame from the
 * domain's Chat Spin, which the renderer cannot import.
 */
export const verticalOverlayProps = (p: {
  fps: number;
  durationInFrames: number;
  subtitles: Subtitle[];
  ctaDurationInFrames: number;
  clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>;
  clipDurations: ReadonlyArray<ExportClipDuration>;
}) => ({
  width: 1080,
  height: 1920,
  fps: p.fps,
  durationInFrames: p.durationInFrames,
  subtitles: p.subtitles,
  cta: { variant: "ai" as const, durationInFrames: p.ctaDurationInFrames },
  chatCards: chatCardProps(p.clips, p.clipDurations, p.fps),
});

/** A Short's Chat Cards, in frames on its timeline. */
export const chatCardProps = (
  clips: ReadonlyArray<{ overlays: ReadonlyArray<ExportOverlay> }>,
  clipDurations: ReadonlyArray<ExportClipDuration>,
  fps: number
) =>
  placeOnTimeline(clips, clipDurations)
    .filter(({ overlay }) => resolveOverlayKind(overlay.kind) === "chatCard")
    .map(({ overlay, startInSeconds, endInSeconds }) => {
      const startFrame = Math.round(startInSeconds * fps);
      const durationInFrames = Math.max(
        1,
        Math.round(endInSeconds * fps) - startFrame
      );
      const cells = overlay.chatSpin ?? [];
      return {
        author: overlay.title,
        text: overlay.description,
        cells,
        startFrame,
        durationInFrames,
        ...chatCardMotion({
          cellCount: cells.length + 1,
          fps,
          durationInFrames,
          disableEnterAnimation: overlay.disableEnterAnimation,
          disableExitAnimation: overlay.disableExitAnimation,
        }),
        ...CHAT_CARD_PLACEMENT,
      };
    });
