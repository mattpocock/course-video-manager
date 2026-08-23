import { useMemo } from "react";
import { Player } from "@remotion/player";
import {
  DefinitionCardPreview,
  type DefinitionCard as DefinitionCardInputProps,
} from "@cvm/overlay-renderer/card";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";

/**
 * One Overlay as the editor needs it: exactly the columns
 * `OverlayOperationsService.listOverlaysByVideoId` returns (see
 * `packages/core/services/db-overlay-operations.server.ts`), shaped for the
 * client. `at`/`durationInSeconds` are already Clip-relative — this is a
 * client-side echo of the DB row, not a new coordinate system.
 */
export type ClipOverlay = {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  title: string;
  description: string;
};

/**
 * Every Definition Card renders at the landscape export frame regardless of
 * this Video's own format — see `DEFINITION_CARD_FRAME` in
 * `overlay-render-cache.ts`, which this mirrors so the preview matches what
 * export actually composites.
 */
const { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT } =
  VIDEO_FORMAT_DIMENSIONS.landscape;

/**
 * The frame rate every Definition Card is rendered at — see
 * `DEFINITION_CARD_FPS` in `overlay-render-cache.ts`. Duplicated rather than
 * imported: that constant lives in a `.server.ts`-adjacent service module
 * pulled into the loader's Effect graph, and importing it here would pull
 * that graph into the client bundle for one number. The source footage is
 * always 60fps too, so there is no mismatch to reconcile against `currentTime`.
 */
const DEFINITION_CARD_FPS = 60;

/** The Overlay active at `currentTime`, or `undefined` if none is. */
const findActiveOverlay = (overlays: ClipOverlay[], currentTime: number) =>
  overlays.find(
    (overlay) =>
      currentTime >= overlay.at &&
      currentTime < overlay.at + overlay.durationInSeconds
  );

/**
 * The overlay preview for one Clip: at most one Definition Card, rendered by
 * an independent `@remotion/player` `<Player>` layered over the Clip's own
 * `<video>` (see `preloadable-clip.tsx`, which positions this absolutely on
 * top and keeps its own playback untouched).
 *
 * Read-only — there is no in-UI authoring here, only a preview of what `cvm
 * overlay` has already created. If more than one Overlay somehow overlaps at
 * `currentTime` (not something `cvm overlay` guards against today), the first
 * one found wins; that is a rare edge case not worth solving elegantly.
 *
 * Keyed by the active Overlay's `id` so switching from one Overlay to another
 * remounts the `<Player>` — a fresh render from frame 0 — rather than trying
 * to seek an existing one to a new composition.
 */
export const OverlayPreview = (props: {
  overlays: ClipOverlay[];
  /** This Clip's own current playback position, in seconds. */
  currentTime: number;
}) => {
  const active = useMemo(
    () => findActiveOverlay(props.overlays, props.currentTime),
    [props.overlays, props.currentTime]
  );

  if (!active) {
    return null;
  }

  const durationInFrames = Math.ceil(
    active.durationInSeconds * DEFINITION_CARD_FPS
  );

  const inputProps: DefinitionCardInputProps = {
    title: active.title,
    description: active.description,
    startFrame: 0,
    durationInFrames,
  };

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      <Player
        key={active.id}
        component={DefinitionCardPreview}
        inputProps={inputProps}
        fps={DEFINITION_CARD_FPS}
        durationInFrames={durationInFrames}
        compositionWidth={COMPOSITION_WIDTH}
        compositionHeight={COMPOSITION_HEIGHT}
        style={{ width: "100%", height: "100%" }}
        autoPlay
        loop={false}
        controls={false}
      />
    </div>
  );
};
