import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  AnimaticComposition,
  type AnimaticCompositionProps,
} from "./animatic-composition";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  formatRunTime,
  segmentIndexAtFrame,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * The Animatic as the author watches it — a Video's Clip Mockups played in
 * order, full screen, from the student's seat.
 *
 * Three things beyond plain playback, all of them there because of what the
 * author does next. The POSITION shows in a corner the whole time, because the
 * feedback he gives is "number 14 is too dense" and he cannot count frames
 * back afterwards. The LIST jumps, because a note is written by re-watching
 * one moment, not by scrubbing for it. The RUN TIME shows, because the point
 * of an Animatic is knowing a Lesson runs thirty-four minutes before anything
 * is filmed.
 */

export const AnimaticPlayer = (props: {
  mockups: AnimaticClipMockup[];
  width: number;
  height: number;
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);

  const timeline = useMemo(
    () => buildAnimaticTimeline(props.mockups),
    [props.mockups]
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrameUpdate = (event: { detail: { frame: number } }) =>
      setFrame(event.detail.frame);
    player.addEventListener("frameupdate", onFrameUpdate);
    return () => player.removeEventListener("frameupdate", onFrameUpdate);
  }, []);

  const activeIndex = segmentIndexAtFrame(timeline.segments, frame);
  const active = activeIndex >= 0 ? timeline.segments[activeIndex] : undefined;

  const broken = props.mockups.filter((m) => m.imageMissing || m.audioMissing);

  const inputProps: AnimaticCompositionProps = {
    segments: [...timeline.segments],
  };

  return (
    <div className="flex h-screen w-screen bg-black text-white">
      <div className="relative flex-1 min-w-0">
        <Player
          ref={playerRef}
          component={AnimaticComposition}
          inputProps={inputProps}
          fps={ANIMATIC_FPS}
          durationInFrames={timeline.durationInFrames}
          compositionWidth={props.width}
          compositionHeight={props.height}
          style={{ width: "100%", height: "100%" }}
          controls
          loop={false}
          clickToPlay
          spaceKeyToPlayOrPause
        />

        {/* The position, in a corner, throughout. */}
        {active && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm tabular-nums tracking-wide">
            {active.mockup.position} / {timeline.segments.length}
          </div>
        )}

        <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm tabular-nums">
          {formatRunTime(timeline.totalSeconds)}
        </div>
      </div>

      <aside className="flex w-96 shrink-0 flex-col border-l border-white/10 bg-neutral-950">
        <header className="border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Clip Mockups</div>
          <div className="text-xs text-white/60">
            {timeline.segments.length} in {formatRunTime(timeline.totalSeconds)}
          </div>
        </header>

        {broken.length > 0 && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <div className="font-semibold">
              {broken.length} Clip Mockup{broken.length === 1 ? "" : "s"} cannot
              play in full
            </div>
            <ul className="mt-1 space-y-0.5">
              {broken.map((m) => (
                <li key={m.id}>
                  #{m.position}:{" "}
                  {[
                    m.imageMissing ? "frame file missing" : null,
                    m.audioMissing ? "speech file missing" : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ol className="min-h-0 flex-1 overflow-y-auto">
          {timeline.segments.map((segment, index) => (
            <li key={segment.mockup.id}>
              <button
                type="button"
                onClick={() => playerRef.current?.seekTo(segment.startFrame)}
                className={cn(
                  "flex w-full gap-3 border-b border-white/5 px-4 py-2.5 text-left text-sm hover:bg-white/10",
                  index === activeIndex && "bg-white/15"
                )}
              >
                <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-white/50">
                  {segment.mockup.position}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-pre-wrap">
                    {segment.mockup.line}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-white/40">
                    {formatRunTime(segment.startFrame / ANIMATIC_FPS)}
                    {(segment.mockup.imageMissing ||
                      segment.mockup.audioMissing) && (
                      <span className="text-amber-300"> · file missing</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
};
