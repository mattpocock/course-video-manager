import { useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  BulletPanelPreview,
  DefinitionCardPreview,
  type BulletPanel as BulletPanelInputProps,
  type DefinitionCard as DefinitionCardInputProps,
} from "@cvm/overlay-renderer/preview";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";
import type { BulletPanelBullet } from "@/features/videos/bullet-panel";
import { resolveOverlayKind } from "@/features/videos/overlay-kind";
import { overlayTransformCssStyleAt } from "@/features/videos/overlay-transform";

/**
 * One Overlay as the editor needs it: exactly the columns
 * `OverlayOperationsService.listOverlaysByVideoId` returns (see
 * `packages/core/services/db-overlay-operations.server.ts`), shaped for the
 * client. `at`/`durationInSeconds` are already Clip-relative — this is a
 * client-side echo of the DB row, not a new coordinate system.
 *
 * One exception: `groupOverlaysByClip` hands a Clip that an Overlay SPILLS
 * onto a copy of that Overlay whose `at` is negative, meaning "this Overlay
 * started that many seconds before this Clip did". `clipId` still names the
 * anchor Clip, and `durationInSeconds` is still the Overlay's own full length.
 */
export type ClipOverlay = {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  /**
   * The raw `kind` column, NOT an `OverlayKind`: every reader here puts it
   * through `resolveOverlayKind`, so a value this build does not know draws
   * the default kind rather than nothing at all.
   */
  kind: string;
  /** A Bullet Panel's bullets, in display order. `null` on every other kind. */
  bullets: BulletPanelBullet[] | null;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
  title: string;
  description: string;
};

/**
 * Every Overlay renders at the landscape export frame regardless of this
 * Video's own format — see `OVERLAY_RENDER_FRAME` in
 * `overlay-render-cache.ts`, which this mirrors so the preview matches what
 * export actually composites.
 */
const { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT } =
  VIDEO_FORMAT_DIMENSIONS.landscape;

/**
 * The frame rate every Overlay is rendered at — see `OVERLAY_RENDER_FPS` in
 * `overlay-render-cache.ts`. Duplicated rather than imported: that constant
 * lives in a `.server.ts`-adjacent service module pulled into the loader's
 * Effect graph, and importing it here would pull that graph into the client
 * bundle for one number. The source footage is always 60fps too, so there is
 * no mismatch to reconcile against `currentTime`.
 */
const OVERLAY_RENDER_FPS = 60;

/**
 * The frame of `overlay`'s own timeline that `currentTime` names, clamped into
 * the Overlay's own duration. `currentTime` and `at` are both relative to the
 * same Clip, so the difference between them is the Overlay's own elapsed time —
 * including when `at` is negative because it began on an earlier Clip, which
 * simply makes that difference larger.
 */
const overlayFrameAt = (overlay: ClipOverlay, currentTime: number) =>
  Math.max(
    0,
    Math.min(
      Math.ceil(overlay.durationInSeconds * OVERLAY_RENDER_FPS) - 1,
      Math.round((currentTime - overlay.at) * OVERLAY_RENDER_FPS)
    )
  );

/**
 * The Overlay active at `currentTime`, or `undefined` if none is.
 *
 * Searched from the end, so that where two Overlays overlap — one spilling off
 * an earlier Clip and one anchored to this one — the later of the two wins.
 * That is the one the export draws on top: `compositeOverlaysOntoExport`
 * chains them in timeline order, so each composites over the one before.
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
 * The camera Transform in force over this Clip at `currentTime`, as CSS for
 * the Clip's own `<video>` — `null` when no Overlay covers the playhead, and
 * when the one that does carries no move (every Definition Card).
 *
 * The preview half of the contract `overlayTransformCropFilter` is the export
 * half of, read at exactly the Overlay `OverlayPreview` draws, so the footage
 * and the graphic on top of it can never move at different moments.
 *
 * The window is stated on the CLIP's clock rather than the flattened Video's —
 * `at` is Clip-relative, and negative for an Overlay spilling in from an
 * earlier Clip — because that is the clock `currentTime` is on. Only the
 * difference between the two is ever used, so the framing is the export's.
 *
 * Clip Zoom is not composed with this, and does not need to be: an Overlay
 * carrying a Transform is refused on a zoomed Clip when it is written (see
 * `cli/commands/overlay.clip-zoom-guard.ts`), so at most one of the two crops
 * is ever in force over one Clip.
 */
export const overlayTransformStyle = (
  overlays: ClipOverlay[],
  currentTime: number
): { transform: string; transformOrigin: string } | null => {
  const active = findActiveOverlay(overlays, currentTime);
  if (!active) {
    return null;
  }
  return overlayTransformCssStyleAt(
    {
      kind: active.kind,
      startInSeconds: active.at,
      endInSeconds: active.at + active.durationInSeconds,
      disableEnterAnimation: active.disableEnterAnimation,
      disableExitAnimation: active.disableExitAnimation,
    },
    currentTime
  );
};

/**
 * The overlay preview for one Clip: at most one Overlay's content — a
 * Definition Card or a Bullet Panel, whichever its Overlay Kind names —
 * rendered by an independent `@remotion/player` `<Player>` layered over the
 * Clip's own `<video>` (see `preloadable-clip.tsx`, which positions this
 * absolutely on top and keeps its own playback untouched).
 *
 * The Kind decides the component AND the props it takes, in one `switch` that
 * a third Kind turns into a compile error — the same shape `overlayContent`
 * has on the export side, so the two cannot come to draw different things.
 *
 * This draws the CONTENT only. The camera move a Kind may also ask for belongs
 * to the footage underneath, so it is applied to the `<video>` itself from
 * `overlayTransformStyle` above; applied here it would move the graphic and
 * leave the footage still.
 *
 * Read-only — there is no in-UI authoring here, only a preview of what `cvm
 * overlay` has already created. At most one Overlay is drawn at a time: where
 * two overlap, the later one wins (see `findActiveOverlay`), which is the one
 * the export puts on top.
 *
 * `overlays` is not only the Overlays anchored to this Clip — it is every
 * Overlay this Clip must DRAW, which `groupOverlaysByClip` widens to include
 * ones that started on an earlier Clip and are still running.
 *
 * The `<Player>` never plays on its own clock. It is held paused and seeked to
 * the frame `currentTime` names, so the content is a pure function of the
 * Clip's playhead — exactly as the export composites it. A free-running
 * `<Player>` would show nothing at all until playback happened to cross the
 * Overlay's `at`, and would then drift away from the footage on pause, on
 * scrub and at any playback rate other than 1x.
 *
 * Keyed by the active Overlay's `id` so switching from one Overlay to another
 * remounts the `<Player>` on the new content, rather than trying to reuse a
 * `<Player>` already mounted on a different composition — which now also
 * covers switching between the two Kinds' components.
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

  // The frame of the content that `currentTime` names. `undefined` when no
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
    active.durationInSeconds * OVERLAY_RENDER_FPS
  );

  // Everything but the composition itself is the same either way. The two
  // `<Player>`s are written out rather than sharing one spread object because
  // `<Player>` is generic in `inputProps`: naming the component and its props
  // together, inside one branch, is what lets each set of props be checked
  // against its own component instead of against a union of both.
  const chrome = {
    fps: OVERLAY_RENDER_FPS,
    durationInFrames,
    compositionWidth: COMPOSITION_WIDTH,
    compositionHeight: COMPOSITION_HEIGHT,
    style: { width: "100%", height: "100%" },
    // Mounted on the frame the playhead already sits on, so content the
    // playhead lands in the middle of does not flash its entrance.
    initialFrame: frame,
    loop: false,
    controls: false,
  } as const;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {(() => {
        switch (resolveOverlayKind(active.kind)) {
          case "bulletPanel": {
            const inputProps: BulletPanelInputProps = {
              title: active.title,
              // `revealAt` is already SECONDS after the Overlay's own start,
              // and the panel is drawn from frame 0 of its own composition, so
              // it crosses this boundary unconverted — exactly as it does into
              // the render (see `overlay-content-renderer.ts`).
              bullets: active.bullets ?? [],
              startFrame: 0,
              durationInFrames,
              // The Animation Toggles cut the panel's own enter/exit, so they
              // are part of what is drawn here as well as of the camera move.
              disableEnterAnimation: active.disableEnterAnimation,
              disableExitAnimation: active.disableExitAnimation,
            };
            return (
              <Player
                key={active.id}
                ref={playerRef}
                component={BulletPanelPreview}
                inputProps={inputProps}
                {...chrome}
              />
            );
          }
          case "definitionCard": {
            const inputProps: DefinitionCardInputProps = {
              title: active.title,
              description: active.description,
              startFrame: 0,
              durationInFrames,
            };
            return (
              <Player
                key={active.id}
                ref={playerRef}
                component={DefinitionCardPreview}
                inputProps={inputProps}
                {...chrome}
              />
            );
          }
        }
      })()}
    </div>
  );
};
