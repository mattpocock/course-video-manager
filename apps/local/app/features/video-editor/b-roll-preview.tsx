import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { resolveOverlayKind } from "@/features/videos/overlay-kind";
import {
  bRollFootageTimeAt,
  findActiveOverlay,
  type ClipOverlay,
} from "./overlay-preview";

/**
 * How far a PLAYING B-roll may drift from where its Overlay says it should be
 * before it is sought back. Seeking a `<video>` on every animation frame would
 * stall it, so while the editor plays the Footage plays on its own clock and
 * is only pulled back into step; paused, it is sought exactly.
 */
const PLAYING_DRIFT_SECONDS = 0.15;

/**
 * Every B-roll this Clip must draw: a muted `<video>` of its Imported Footage
 * (through `view-video`) laid over the Clip's whole picture while the playhead
 * is in its window, and invisible outside it. The Clip's own `<video>` keeps
 * playing underneath, so the author's sound carries on; the B-roll's is never
 * heard.
 *
 * `overlays` is what `groupOverlaysByClip` gave this Clip, so a B-roll spilling
 * in from an earlier Clip is here too, with a negative `at`. Which Overlay is
 * on screen is `findActiveOverlay`'s call, the same one `OverlayPreview` makes,
 * so a B-roll and a card can never both show.
 *
 * Mounted for a preloading Clip too, so a B-roll's Footage is loaded and
 * sought before the playhead reaches it — including the Clip it spills onto.
 */
export const BRollPreview = (props: {
  overlays: ClipOverlay[];
  /** This Clip's own current playback position, in seconds. */
  currentTime: number;
  /** Whether this Clip is the one the editor is playing right now. */
  playing: boolean;
  playbackRate: number;
}) => {
  const bRolls = props.overlays.filter(
    (overlay) =>
      resolveOverlayKind(overlay.kind) === "bRoll" &&
      overlay.footagePath !== null
  );
  if (bRolls.length === 0) {
    return null;
  }
  const active = findActiveOverlay(props.overlays, props.currentTime);

  return (
    <>
      {bRolls.map((overlay) => (
        <BRollVideo
          key={overlay.id}
          footagePath={overlay.footagePath!}
          footageTime={bRollFootageTimeAt(overlay, props.currentTime)}
          visible={active?.id === overlay.id}
          playing={props.playing && active?.id === overlay.id}
          playbackRate={props.playbackRate}
        />
      ))}
    </>
  );
};

const BRollVideo = (props: {
  footagePath: string;
  footageTime: number;
  visible: boolean;
  playing: boolean;
  playbackRate: number;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  // The latest instant the Clip's clock names, for the listener below, which
  // outlives the render that set it.
  const target = useRef(props.footageTime);
  target.current = props.footageTime;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = props.playbackRate;
    const drift = Math.abs(video.currentTime - props.footageTime);
    if (!props.playing) {
      video.pause();
      if (drift > 0) video.currentTime = props.footageTime;
      return;
    }
    if (drift > PLAYING_DRIFT_SECONDS) video.currentTime = props.footageTime;
    if (video.paused) void video.play().catch(() => {});
  }, [props.footageTime, props.playing, props.playbackRate]);

  // The Clip's clock can stall (buffering) while the editor still plays. The
  // B-roll must not run on past it — nor past its window, whose end only that
  // clock can report — so it waits where the clock is until the clock moves.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const holdForClock = () => {
      if (video.currentTime - target.current > PLAYING_DRIFT_SECONDS) {
        video.pause();
        video.currentTime = target.current;
      }
    };
    video.addEventListener("timeupdate", holdForClock);
    return () => video.removeEventListener("timeupdate", holdForClock);
  }, []);

  return (
    <video
      ref={ref}
      src={`/view-video?videoPath=${encodeURIComponent(props.footagePath)}`}
      muted
      playsInline
      preload="auto"
      data-testid="b-roll-preview"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full object-fill",
        !props.visible && "invisible"
      )}
    />
  );
};
