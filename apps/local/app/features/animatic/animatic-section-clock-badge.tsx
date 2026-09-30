import type { PlayerRef } from "@remotion/player";
import { useEffect, useRef, type RefObject } from "react";
import {
  formatSectionClock,
  sectionClockAt,
  type AnimaticSectionRunTime,
} from "./animatic-section-clock";

/**
 * The Section clock, in the stage's top-left corner. See
 * `animatic-section-clock.ts` for what it reads and why.
 *
 * IT MOVES EVERY FRAME, SO IT IS NEVER STATE. Like the fill bars, its text is
 * written straight to the DOM from the Player's own `frameupdate`, so the page
 * still renders once per Clip Mockup rather than thirty times a second.
 */
export const AnimaticSectionClock = (props: {
  playerRef: RefObject<PlayerRef | null>;
  runTime: AnimaticSectionRunTime;
  playbackRate: number;
}) => {
  const badgeRef = useRef<HTMLDivElement>(null);
  const { playerRef, playbackRate } = props;
  const { framesBefore, totalFrames } = props.runTime;

  useEffect(() => {
    const paint = (frame: number) => {
      const badge = badgeRef.current;
      if (!badge) return;
      badge.textContent = formatSectionClock(
        sectionClockAt({
          runTime: { framesBefore, totalFrames },
          frame,
          playbackRate,
        })
      );
    };

    // A new rate or a new Section total repaints at once, even while paused.
    const player = playerRef.current;
    paint(player?.getCurrentFrame() ?? 0);
    if (!player) return;

    const onFrameUpdate = (event: { detail: { frame: number } }) =>
      paint(event.detail.frame);
    player.addEventListener("frameupdate", onFrameUpdate);
    return () => player.removeEventListener("frameupdate", onFrameUpdate);
  }, [playerRef, playbackRate, framesBefore, totalFrames]);

  return (
    <div
      ref={badgeRef}
      title="Through the whole Section, at the speed you are watching"
      className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm tabular-nums tracking-wide"
      suppressHydrationWarning
    />
  );
};
