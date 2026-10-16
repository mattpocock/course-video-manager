import { Player, type PlayerRef } from "@remotion/player";
import { useMemo, type RefObject } from "react";
import {
  VIDEO_FORMAT_DIMENSIONS,
  type VideoFormat,
} from "@/features/videos/video-format";
import {
  AnimaticComposition,
  type AnimaticCompositionProps,
} from "./animatic-composition";
import { ANIMATIC_PLAYBACK_RATES } from "./animatic-playback-rate";
import type { AnimaticSubtitleStyle } from "./animatic-subtitles";
import { ANIMATIC_FPS, type AnimaticTimeline } from "./animatic-timeline";

/**
 * The Remotion Player on the Animatic's stage, sized for the Video's format:
 * 16:9 for a Landscape Video, 9:16 for a Short. The stage letterboxes it.
 */
export const AnimaticStagePlayer = (props: {
  playerRef: RefObject<PlayerRef | null>;
  timeline: AnimaticTimeline;
  format: VideoFormat;
  showSubtitles: boolean;
  subtitleStyle: AnimaticSubtitleStyle;
  playbackRate: number;
  /** The segment to open on. */
  startIndex: number;
  /** Opened on a moment (the editor's Animatic tab): play at once. */
  autoPlay: boolean;
}) => {
  const { timeline, format, showSubtitles, subtitleStyle } = props;
  // Memoised on the timeline alone: a poll that changed nothing hands the
  // Player the very same object, and the composition is not rebuilt.
  const inputProps: AnimaticCompositionProps = useMemo(
    () => ({
      segments: [...timeline.segments],
      format,
      showSubtitles,
      subtitleStyle,
    }),
    [timeline, format, showSubtitles, subtitleStyle]
  );
  const size = VIDEO_FORMAT_DIMENSIONS[format];

  return (
    <Player
      ref={props.playerRef}
      component={AnimaticComposition}
      inputProps={inputProps}
      fps={ANIMATIC_FPS}
      durationInFrames={timeline.durationInFrames}
      compositionWidth={size.width}
      compositionHeight={size.height}
      style={{ width: "100%", height: "100%" }}
      controls
      playbackRate={props.playbackRate}
      showPlaybackRateControl={ANIMATIC_PLAYBACK_RATES}
      loop={false}
      // Opened on a moment (the editor's Animatic tab): start there, and
      // play — the click that opened it was the press of play.
      initialFrame={timeline.segments[props.startIndex]?.startFrame ?? 0}
      autoPlay={props.autoPlay}
      clickToPlay
      // SPACE is ours, not the Player's — leaving both on toggles playback
      // twice whenever the Player holds focus, which is right after a click
      // on the picture.
      spaceKeyToPlayOrPause={false}
    />
  );
};
