import type { PlayerRef } from "@remotion/player";

/**
 * Start the Animatic playing at a given frame — and be the ONLY thing that
 * decides it is playing.
 *
 * WHY THIS IS NOT `seekTo()` THEN `play()`. Remotion's `seekTo` owns resuming
 * by itself. Called while the Player is playing, it pauses, writes down an
 * internal "resume after this seek" latch, and seeks; an effect inside the
 * Player then reads that latch and plays again. The effect only fires while the
 * Player reports itself PAUSED.
 *
 * Play straight after the seek and we win that race: the effect sees a Player
 * that is already playing, does nothing, and THE LATCH STAYS ARMED. It is armed
 * until the Player's playing state next changes — so the author's next click on
 * the Player's own pause button pauses, re-runs that effect, and is undone by
 * the resume it was waiting to do. The button reads as stuck and the second
 * click is the one that works. That is the bug this exists to stop.
 *
 * PAUSING FIRST is what keeps the latch out of it. The Player's imperative
 * `pause()` clears the latch and reports itself paused at once, so the `seekTo`
 * that follows has nothing to resume and arms nothing; the `play()` after it is
 * then the single owner of the fact that the Animatic is playing.
 *
 * Every way into a Clip Mockup goes through here — a click on a row, a click on
 * a Chapter divider, RETURN on a selected row — because any one of them left as
 * a bare seek-then-play re-arms the latch for all of them.
 */
export type AnimaticTransport = Pick<
  PlayerRef,
  "isPlaying" | "pause" | "play" | "seekTo"
>;

export function startPlayingAt(
  player: AnimaticTransport | null | undefined,
  frame: number
): void {
  if (!player) return;
  if (player.isPlaying()) {
    player.pause();
  }
  player.seekTo(frame);
  player.play();
}
