import { useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
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
 *
 * One exception: `groupOverlaysByClip` hands a Clip that an Overlay SPILLS
 * onto a copy of that Overlay whose `at` is negative, meaning "this card
 * started that many seconds before this Clip did". `clipId` still names the
 * anchor Clip, and `durationInSeconds` is still the card's own full length.
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

/**
 * The frame of `overlay`'s own card timeline that `currentTime` names, clamped
 * into the card's own duration. `currentTime` and `at` are both relative to
 * the same Clip, so the difference between them is the card's own elapsed
 * time — including when `at` is negative because the card began on an earlier
 * Clip, which simply makes that difference larger.
 */
const overlayFrameAt = (overlay: ClipOverlay, currentTime: number) =>
  Math.max(
    0,
    Math.min(
      Math.ceil(overlay.durationInSeconds * DEFINITION_CARD_FPS) - 1,
      Math.round((currentTime - overlay.at) * DEFINITION_CARD_FPS)
    )
  );

/**
 * The Overlay active at `currentTime`, or `undefined` if none is.
 *
 * Searched from the end, so that where two Overlays overlap — a card spilling
 * off an earlier Clip and a card anchored to this one — the later of the two
 * wins. That is the one the export draws on top: `compositeOverlaysOntoExport`
 * chains the cards in timeline order, so each composites over the one before.
 */
const findActiveOverlay = (overlays: ClipOverlay[], currentTime: number) => {
  for (let index = overlays.length - 1; index >= 0; index--) {
    const overlay = overlays[index]!;
    if (
      currentTime >= overlay.at &&
      currentTime < overlay.at + overlay.durationInSeconds
    ) {
      return overlay;
    }
  }
  return undefined;
};

/**
 * The overlay preview for one Clip: at most one Definition Card, rendered by
 * an independent `@remotion/player` `<Player>` layered over the Clip's own
 * `<video>` (see `preloadable-clip.tsx`, which positions this absolutely on
 * top and keeps its own playback untouched).
 *
 * Read-only — there is no in-UI authoring here, only a preview of what `cvm
 * overlay` has already created. At most one card is drawn at a time: where two
 * overlap, the later one wins (see `findActiveOverlay`), which is the one the
 * export puts on top but is not the two-card stack the export would show.
 *
 * `overlays` is not only the Overlays anchored to this Clip — it is every
 * Overlay this Clip must DRAW, which `groupOverlaysByClip` widens to include
 * cards that started on an earlier Clip and are still running.
 *
 * The `<Player>` never plays on its own clock. It is held paused and seeked to
 * the frame `currentTime` names, so the card is a pure function of the Clip's
 * playhead — exactly as the export composites it. A free-running `<Player>`
 * would show nothing at all until playback happened to cross the Overlay's
 * `at`, and would then drift away from the footage on pause, on scrub and at
 * any playback rate other than 1x.
 *
 * Keyed by the active Overlay's `id` so switching from one Overlay to another
 * remounts the `<Player>` on the new card, rather than trying to reuse a
 * `<Player>` that is already mounted on a different composition.
 */
export const OverlayPreview = (props: {
  overlays: ClipOverlay[];
  /** This Clip's own current playback position, in seconds. */
  currentTime: number;
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const active = useMemo(
    () => findActiveOverlay(props.overlays, props.currentTime),
    [props.overlays, props.currentTime]
  );

  // The frame of the card that `currentTime` names. `undefined` when no
  // Overlay covers the playhead — computed before the early return below so
  // the seek effect keeps a stable hook order.
  const frame = active ? overlayFrameAt(active, props.currentTime) : undefined;

  useEffect(() => {
    if (frame === undefined) {
      return;
    }
    playerRef.current?.seekTo(frame);
  }, [frame]);

  if (!active || frame === undefined) {
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
        ref={playerRef}
        component={DefinitionCardPreview}
        inputProps={inputProps}
        fps={DEFINITION_CARD_FPS}
        durationInFrames={durationInFrames}
        compositionWidth={COMPOSITION_WIDTH}
        compositionHeight={COMPOSITION_HEIGHT}
        style={{ width: "100%", height: "100%" }}
        // Mounted on the frame the playhead already sits on, so a card the
        // playhead lands in the middle of does not flash its entrance.
        initialFrame={frame}
        loop={false}
        controls={false}
      />
    </div>
  );
};
