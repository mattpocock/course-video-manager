import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipOnDatabase, FrontendId } from "./clip-state-reducer";
import { cn } from "@/lib/utils";
import { clipZoomCssStyle } from "@/features/videos/clip-zoom";
import {
  BEAT_DURATION,
  FINAL_VIDEO_PADDING,
  PREVIEW_AUDIO_BOOST_DB,
} from "./constants";
import { useAudioBoost } from "./use-audio-boost";
import type { RunningState } from "./video-state-reducer";
import { OverlayPreview, type ClipOverlay } from "./overlay-preview";

const PRELOAD_PLAY_AMOUNT = 0.1;

export const PreloadableClip = (props: {
  playbackRate: number;
  clip: ClipOnDatabase;
  onFinish: () => void;
  aggressivePreload: boolean;
  onPreloadComplete: () => void;
  hidden: boolean;
  state: RunningState;
  onUpdateCurrentTime: (time: number) => void;
  profile: string | undefined;
  scrubSeekTime: number | undefined;
  /** This Clip's own Overlays only — already filtered by `clip_id` upstream. */
  overlays: ClipOverlay[];
}) => {
  const [preloadState, setPreloadState] = useState<"preloading" | "finished">(
    "preloading"
  );
  // The overlay preview's own clip-relative playhead. Mirrors what
  // `onUpdateCurrentTime` below sends up to the reducer's `currentTimeInClip`,
  // but kept local too: `OverlayPreview` needs it on every frame this Clip is
  // the one playing, and re-deriving it from context would mean threading
  // context into an otherwise prop-only component.
  const [overlayCurrentTime, setOverlayCurrentTime] = useState(0);
  const ref = useRef<HTMLVideoElement>(null);
  useAudioBoost(ref, PREVIEW_AUDIO_BOOST_DB);

  const preloadFrom = props.clip.sourceStartTime - PRELOAD_PLAY_AMOUNT;
  const preloadTo = props.clip.sourceStartTime;
  const modifiedEndTime = props.clip.sourceEndTime - 0.06;

  const isPlaying = !props.hidden && props.state === "playing";

  // Keeps the overlay playhead in step with the `<video>` while it is NOT
  // playing. The rAF loop below stops on pause and never runs before the first
  // play, so on its own it leaves `overlayCurrentTime` at 0 — a paused or
  // scrubbed Clip would show no Definition Card at all, however far into an
  // Overlay the playhead sits.
  useEffect(() => {
    const video = ref.current;
    if (!video || props.hidden || props.overlays.length === 0) {
      return;
    }

    const sync = () =>
      setOverlayCurrentTime(video.currentTime - props.clip.sourceStartTime);

    sync();
    video.addEventListener("seeked", sync);
    video.addEventListener("timeupdate", sync);
    return () => {
      video.removeEventListener("seeked", sync);
      video.removeEventListener("timeupdate", sync);
    };
  }, [
    ref.current,
    props.hidden,
    props.overlays.length,
    props.clip.sourceStartTime,
  ]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    ref.current.playbackRate = props.playbackRate;
  }, [props.playbackRate, ref.current]);

  useEffect(() => {
    if (!ref.current || props.hidden || props.scrubSeekTime === undefined) {
      return;
    }
    ref.current.pause();
    ref.current.currentTime = props.scrubSeekTime;
  }, [props.scrubSeekTime, props.hidden, ref.current]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    if (preloadState === "preloading" && props.aggressivePreload) {
      ref.current.muted = true;
      ref.current.play();
      return;
    }

    if (props.hidden || !props.aggressivePreload) {
      ref.current.pause();
      ref.current.currentTime = props.clip.sourceStartTime;
      ref.current.muted = false;
      return;
    }

    if (isPlaying) {
      ref.current.play();
    } else {
      ref.current.pause();
    }
  }, [
    props.hidden,
    ref.current,
    props.state,
    preloadState,
    props.aggressivePreload,
  ]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    if (!isPlaying && preloadState === "finished") {
      return;
    }
    let animationId: number | null = null;

    const checkCurrentTime = () => {
      const currentTime = ref.current!.currentTime;

      if (preloadState === "preloading") {
        if (currentTime >= preloadTo) {
          setPreloadState("finished");
          ref.current?.pause();
          ref.current!.muted = false;
          ref.current!.currentTime = preloadTo;
          props.onPreloadComplete();
        }
      } else if (currentTime >= modifiedEndTime) {
        ref.current!.pause();
        props.onFinish();
        ref.current!.currentTime = props.clip.sourceStartTime;
        return;
      }

      const clipRelativeTime = currentTime - props.clip.sourceStartTime;
      props.onUpdateCurrentTime(clipRelativeTime);
      if (props.overlays.length > 0) {
        setOverlayCurrentTime(clipRelativeTime);
      }

      animationId = requestAnimationFrame(checkCurrentTime);
    };

    animationId = requestAnimationFrame(checkCurrentTime);

    return () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [
    ref.current,
    isPlaying,
    preloadState,
    modifiedEndTime,
    props.clip.sourceStartTime,
    preloadTo,
    props.onUpdateCurrentTime,
    props.overlays.length,
  ]);

  return (
    <div className={cn("relative w-full", props.hidden && "hidden")}>
      <video
        key={props.clip.frontendId}
        src={`/view-video?videoPath=${props.clip.videoFilename}#t=${preloadFrom},${modifiedEndTime}`}
        className={cn(
          "w-full",
          props.profile === "TikTok" && "w-92 aspect-[9/16]"
        )}
        // The preview half of the Clip Zoom contract. These two properties are
        // formatted from the same rect the export's ffmpeg crop is built from
        // (see features/videos/clip-zoom), so what plays here is what ships.
        style={clipZoomCssStyle(props.clip.zoomType) ?? undefined}
        ref={ref}
      />
      {/* Only mounted for the Clip actually on screen — every other Clip in
          the manager is preloading off-screen (`hidden`), and there is no
          reason to run an extra `<Player>` per one of those. */}
      {!props.hidden && props.overlays.length > 0 && (
        <OverlayPreview
          overlays={props.overlays}
          currentTime={overlayCurrentTime}
        />
      )}
    </div>
  );
};

export const PreloadableClipManager = (props: {
  playbackRate: number;
  clips: ClipOnDatabase[];
  finalClipId: string | undefined;
  clipsToAggressivelyPreload: string[];
  state: RunningState;
  currentClipId: FrontendId | undefined;
  currentClipProfile: string | undefined;
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
  scrubSeekTime: number | undefined;
  /** Every Overlay on this Video — grouped below by `clip_id` per Clip. */
  overlays: ClipOverlay[];
}) => {
  // Grouped once per `overlays` change rather than `.filter()`-ed per Clip
  // per render — this Video may have many Clips, each re-rendering on every
  // playhead tick.
  const overlaysByClipId = useMemo(() => {
    const map = new Map<string, ClipOverlay[]>();
    for (const overlay of props.overlays) {
      const forClip = map.get(overlay.clipId);
      if (forClip) {
        forClip.push(overlay);
      } else {
        map.set(overlay.clipId, [overlay]);
      }
    }
    return map;
  }, [props.overlays]);

  return (
    <div className="">
      {props.clips.map((clip) => {
        const isCurrentlyPlaying = clip.frontendId === props.currentClipId;

        const onFinish = () => {
          if (!isCurrentlyPlaying) {
            return;
          }

          if (clip.pauseType === "long") {
            setTimeout(() => {
              props.onClipFinished();
            }, BEAT_DURATION * 1000);
          } else {
            props.onClipFinished();
          }
        };

        const isFinalClip = clip.frontendId === props.finalClipId;

        const modifiedClip = isFinalClip
          ? { ...clip, sourceEndTime: clip.sourceEndTime + FINAL_VIDEO_PADDING }
          : clip;

        return (
          <div key={clip.frontendId}>
            <PreloadableClip
              playbackRate={props.playbackRate}
              clip={modifiedClip}
              key={clip.frontendId}
              onFinish={onFinish}
              aggressivePreload={props.clipsToAggressivelyPreload.includes(
                clip.frontendId
              )}
              hidden={!isCurrentlyPlaying}
              state={props.state}
              profile={props.currentClipProfile}
              onUpdateCurrentTime={(time) => {
                if (isCurrentlyPlaying) {
                  props.onUpdateCurrentTime(time);
                }
              }}
              onPreloadComplete={() => {}}
              scrubSeekTime={
                isCurrentlyPlaying ? props.scrubSeekTime : undefined
              }
              overlays={overlaysByClipId.get(clip.databaseId) ?? EMPTY_OVERLAYS}
            />
          </div>
        );
      })}
    </div>
  );
};

/** A stable empty array, so a Clip with no Overlays gets the same reference
 * on every render instead of a fresh `[]` retriggering its effects. */
const EMPTY_OVERLAYS: ClipOverlay[] = [];
