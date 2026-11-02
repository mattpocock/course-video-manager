import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { footageLayerTime, type FootageLayer } from "@/packages/clip-source";
import {
  VIDEO_FORMAT_DIMENSIONS,
  type VideoFormat,
} from "@/features/videos/video-format";

/**
 * How far a PLAYING Footage Layer may drift from where its Clip says it
 * should be before it is sought back. Seeking a `<video>` on every animation
 * frame would stall it, so while the editor plays the Footage plays on its
 * own clock and is only pulled back into step; paused, it is sought exactly.
 */
const PLAYING_DRIFT_SECONDS = 0.15;

/** The export's frame rate: the preview reads Footage on its frame grid. */
const EXPORT_FPS = 60;

/**
 * Where in its Footage a Footage Layer is at `currentTime` (seconds into its
 * Clip): {@link footageLayerTime} of the time since its span began, on the
 * export's floored frame grid, so the preview shows the frame the export
 * draws.
 */
export const footageLayerTimeAt = (
  layer: FootageLayer,
  currentTime: number
): number =>
  footageLayerTime(
    layer.start,
    Math.max(0, Math.floor((currentTime - layer.span.at) * EXPORT_FPS)) /
      EXPORT_FPS
  );

/** Whether the Footage Layer is drawn at `currentTime`, seconds into its Clip. */
const inSpan = (layer: FootageLayer, currentTime: number) =>
  currentTime >= layer.span.at &&
  (layer.span.duration === null ||
    currentTime < layer.span.at + layer.span.duration);

/**
 * A Clip's Footage Layers over its picture, bottom to top: each a muted
 * `<video>` of its Footage (through `view-video`), its Source Crop shown at
 * its Placement in the Video's frame while the playhead is in its span, and
 * invisible outside it. The Clip's own `<video>` keeps playing underneath, so
 * the Clip's sound carries on; a Footage Layer's is not played here.
 *
 * Mounted for a preloading Clip too, so the Footage is loaded and sought
 * before the playhead reaches it.
 */
export const FootageLayersPreview = (props: {
  layers: readonly FootageLayer[];
  /** This Clip's own current playback position, in seconds. */
  currentTime: number;
  /** Whether this Clip is the one the editor is playing right now. */
  playing: boolean;
  playbackRate: number;
  videoFormat: VideoFormat;
}) => {
  if (props.layers.length === 0) {
    return null;
  }
  const frame = VIDEO_FORMAT_DIMENSIONS[props.videoFormat];
  return (
    <>
      {props.layers.map((layer, index) => {
        const visible = inSpan(layer, props.currentTime);
        return (
          <FootageLayerVideo
            key={index}
            layer={layer}
            frame={frame}
            footageTime={footageLayerTimeAt(layer, props.currentTime)}
            visible={visible}
            playing={props.playing && visible}
            playbackRate={props.playbackRate}
          />
        );
      })}
    </>
  );
};

const percent = (n: number) => `${n * 100}%`;

const FootageLayerVideo = (props: {
  layer: FootageLayer;
  frame: { width: number; height: number };
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
  // Footage must not run on past it, nor past its span, whose end only that
  // clock can report, so it waits where the clock is until the clock moves.
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

  const { placement, sourceCrop: crop } = props.layer;
  // The Placement, as fractions of the Video's frame; inside it, the whole
  // Footage scaled so that its Source Crop fills the box.
  return (
    <div
      className={cn(
        "pointer-events-none absolute overflow-hidden",
        !props.visible && "invisible"
      )}
      style={{
        left: percent(placement.x / props.frame.width),
        top: percent(placement.y / props.frame.height),
        width: percent(placement.w / props.frame.width),
        height: percent(placement.h / props.frame.height),
      }}
    >
      <video
        ref={ref}
        src={`/view-video?videoPath=${encodeURIComponent(props.layer.file)}`}
        muted
        playsInline
        preload="auto"
        data-testid="footage-layer-preview"
        className="absolute max-w-none object-fill"
        style={{
          left: percent(-crop.x / crop.w),
          top: percent(-crop.y / crop.h),
          width: percent(1 / crop.w),
          height: percent(1 / crop.h),
        }}
      />
    </div>
  );
};
