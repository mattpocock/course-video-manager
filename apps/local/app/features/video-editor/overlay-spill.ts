import type { Clip } from "./clip-state-reducer";
import { BEAT_DURATION } from "./constants";
import type { ClipOverlay } from "./overlay-preview";

/**
 * One Clip as the spill walk needs it.
 *
 * `durationInSeconds` is how long the Clip holds the PREVIEW playhead — its
 * own length plus its Beat, if it has one — not how long the export gives it.
 * The two differ by a fraction of a second per Beat (`BEAT_DURATION` here
 * against `LONG_PAUSE_DURATION_IN_SECONDS` there), which is close enough to
 * show an author where a card lands, and is the clock the card is actually
 * drawn against on screen.
 */
export type OverlaySpillClip = {
  /**
   * `null` for a Clip that is not on the database yet. Such a Clip owns no
   * Overlays and the preview does not render it, but it still takes up time.
   */
  databaseId: string | null;
  /** `null` when the Clip's length is not known yet. */
  durationInSeconds: number | null;
};

/**
 * The Video's Clips measured for the spill walk, in playback order.
 *
 * A Clip the preview cannot play — one not on the database yet — is kept in
 * the list rather than dropped, with no length, so that an Overlay stops at it
 * instead of silently jumping the gap it leaves.
 */
export const toOverlaySpillClips = (
  clips: readonly Clip[]
): OverlaySpillClip[] =>
  clips.map((clip) =>
    clip.type === "on-database"
      ? {
          databaseId: clip.databaseId,
          durationInSeconds:
            clip.sourceEndTime -
            clip.sourceStartTime +
            // The Beat the preview waits out before it starts the next Clip.
            (clip.pauseType === "long" ? BEAT_DURATION : 0),
        }
      : { databaseId: null, durationInSeconds: null }
  );

/**
 * Every Overlay each Clip must draw, keyed by Clip database id.
 *
 * An Overlay lasts as long as it says, not as long as its anchor Clip. One
 * that outlives its Clip keeps showing over the Clips that follow, and the
 * export composites it exactly so — see `placeOverlaysOnTimeline` in
 * `app/services/overlay-compositing.ts`. This gives the preview the same
 * behaviour, so an author sees a long card the way the final edit will play
 * it instead of watching it disappear at the Clip boundary.
 *
 * Each Clip the Overlay reaches gets its own copy of it, with `at` made
 * relative to THAT Clip. For every Clip after the anchor that `at` is
 * negative — the card started that many seconds before the Clip did — which
 * `overlayFrameAt` reads correctly with no special case, and which puts the
 * card on screen part-way through rather than at its entrance.
 *
 * `clips` must be the whole Video in playback order. The walk stops at a Clip
 * of unknown length rather than guessing where the Clip after it starts.
 */
export const groupOverlaysByClip = (
  clips: readonly OverlaySpillClip[],
  overlays: readonly ClipOverlay[]
): Map<string, ClipOverlay[]> => {
  const indexOfClip = new Map<string, number>();
  clips.forEach((clip, index) => {
    if (clip.databaseId !== null) {
      indexOfClip.set(clip.databaseId, index);
    }
  });

  const byClip = new Map<string, ClipOverlay[]>();
  const add = (databaseId: string, overlay: ClipOverlay) => {
    const forClip = byClip.get(databaseId);
    if (forClip) {
      forClip.push(overlay);
    } else {
      byClip.set(databaseId, [overlay]);
    }
  };

  for (const overlay of overlays) {
    const anchor = indexOfClip.get(overlay.clipId);
    if (anchor === undefined) {
      continue;
    }

    const endsAt = overlay.at + overlay.durationInSeconds;
    // Seconds from the start of the anchor Clip to the start of `clips[index]`.
    let clipStartsAt = 0;

    for (let index = anchor; index < clips.length; index++) {
      if (clipStartsAt >= endsAt) {
        break;
      }

      const clip = clips[index]!;
      if (clip.databaseId !== null) {
        add(clip.databaseId, { ...overlay, at: overlay.at - clipStartsAt });
      }

      if (clip.durationInSeconds === null) {
        break;
      }
      clipStartsAt += clip.durationInSeconds;
    }
  }

  return byClip;
};
