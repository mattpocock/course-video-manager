import { useEffect, useRef, useState } from "react";
import type { ClipOnDatabase, FrontendId } from "./clip-state-reducer";
import { cn } from "@/lib/utils";
import { FINAL_VIDEO_PADDING } from "./constants";
import type { RunningState } from "./video-state-reducer";

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
}) => {
  const [preloadState, setPreloadState] = useState<"preloading" | "finished">(
    "preloading"
  );
  const ref = useRef<HTMLVideoElement>(null);

  const preloadFrom = props.clip.sourceStartTime - PRELOAD_PLAY_AMOUNT;
  const preloadTo = props.clip.sourceStartTime;
  const modifiedEndTime = props.clip.sourceEndTime - 0.06;

  const isPlaying = !props.hidden && props.state === "playing";

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    ref.current.playbackRate = props.playbackRate;
  }, [props.playbackRate, ref.current]);

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
        props.onFinish();
        ref.current!.currentTime = props.clip.sourceStartTime;
        return;
      }

      props.onUpdateCurrentTime(currentTime - props.clip.sourceStartTime);

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
  ]);

  return (
    <video
      key={props.clip.frontendId}
      src={`/view-video?videoPath=${props.clip.videoFilename}#t=${preloadFrom},${modifiedEndTime}`}
      className={cn(props.hidden && "hidden")}
      ref={ref}
    />
  );
};

export const PreloadableClipManager = (props: {
  playbackRate: number;
  clips: ClipOnDatabase[];
  finalClipId: string | undefined;
  clipsToAggressivelyPreload: string[];
  state: RunningState;
  currentClipId: FrontendId | undefined;
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
}) => {
  return (
    <div className="">
      {props.clips.map((clip) => {
        const isCurrentlyPlaying = clip.frontendId === props.currentClipId;

        const onFinish = () => {
          if (!isCurrentlyPlaying) {
            return;
          }

          props.onClipFinished();
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
              onUpdateCurrentTime={(time) => {
                if (isCurrentlyPlaying) {
                  props.onUpdateCurrentTime(time);
                }
              }}
              onPreloadComplete={() => {}}
            />
          </div>
        );
      })}
    </div>
  );
};
