import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import {
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  Loader2,
  MicIcon,
  MicOffIcon,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Clip } from "./clip-state-reducer";
import { OBSConnectionButton, type OBSConnectionState } from "./obs-connector";
import { PreloadableClipManager } from "./preloadable-clip";
import { TitleSection } from "./title-section";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import { makeVideoEditorReducer } from "./video-state-reducer";

export const VideoEditor = (props: {
  obsConnectorState: OBSConnectionState;
  clips: Clip[];
  videoPath: string;
  lessonPath: string;
  repoName: string;
  repoId: string;
  lessonId: string;
  videoId: string;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  clipIdsBeingTranscribed: Set<string>;
  onClipsRemoved: (clipIds: string[]) => void;
}) => {
  const [state, dispatch] = useReducer(
    makeVideoEditorReducer(
      (effect) => {
        if (effect.type === "archive-clips") {
          props.onClipsRemoved(effect.clipIds);
        }
      },
      props.clips.map((clip) => clip.id)
    ),
    {
      forceViewTimeline: false,
      runningState: "paused",
      currentClipId: props.clips[0]?.id ?? "",
      currentTimeInClip: 0,
      selectedClipsSet: new Set<string>(),
      clipIdsPreloaded: new Set<string>(
        [props.clips[0]?.id, props.clips[1]?.id].filter(
          (id) => id !== undefined
        )
      ),
      playbackRate: 1,
    }
  );

  const currentClipIndex = props.clips.findIndex(
    (clip) => clip.id === state.currentClipId
  );

  const nextClip = props.clips[currentClipIndex + 1];

  const selectedClipId = Array.from(state.selectedClipsSet)[0];

  const clipsToAggressivelyPreload = [
    state.currentClipId,
    nextClip?.id,
    selectedClipId,
  ].filter((id) => id !== undefined);

  const currentClipId = state.currentClipId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        dispatch({ type: "press-space-bar" });
      } else if (e.key === "Delete") {
        dispatch({ type: "press-delete" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        dispatch({ type: "press-return" });
      } else if (e.key === "ArrowLeft") {
        dispatch({ type: "press-arrow-left" });
      } else if (e.key === "ArrowRight") {
        dispatch({ type: "press-arrow-right" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        dispatch({ type: "press-arrow-up" });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        dispatch({ type: "press-arrow-down" });
      } else if (e.key === "l") {
        dispatch({ type: "press-l" });
      } else if (e.key === "k") {
        dispatch({ type: "press-k" });
      } else if (e.key === "Home") {
        dispatch({ type: "press-home" });
      } else if (e.key === "End") {
        dispatch({ type: "press-end" });
      } else if (e.key === "v") {
        dispatch({ type: "keydown-v" });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "v") {
        dispatch({ type: "keyup-v" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const exportVideoClipsFetcher = useFetcher();

  const totalDuration = props.clips.reduce((acc, clip) => {
    if (clip.type === "on-database") {
      return acc + (clip.sourceEndTime - clip.sourceStartTime);
    }
    return acc;
  }, 0);

  const shouldShowVideoPlayer =
    !props.liveMediaStream ||
    state.runningState === "playing" ||
    state.forceViewTimeline;

  return (
    <div className="flex flex-col lg:flex-row p-6 gap-6 gap-y-10">
      {/* Video Player Section - Shows first on mobile, second on desktop */}
      <div className="lg:flex-1 relative order-1 lg:order-2">
        <div className="sticky top-6">
          <div className="">
            <div className="mb-4">
              <TitleSection
                videoPath={
                  props.videoPath +
                  " (" +
                  formatSecondsToTimeCode(totalDuration) +
                  ")"
                }
                lessonPath={props.lessonPath}
                repoName={props.repoName}
              />
            </div>

            {props.liveMediaStream && (
              <div
                className={cn(
                  "w-full h-full relative aspect-[16/9]",
                  (props.obsConnectorState.type === "obs-connected" ||
                    props.obsConnectorState.type === "obs-recording" ||
                    props.obsConnectorState.type === "obs-paused") &&
                    props.obsConnectorState.profile === "TikTok" &&
                    "w-92 aspect-[9/16]",
                  shouldShowVideoPlayer && "hidden"
                )}
              >
                {props.obsConnectorState.type === "obs-recording" && (
                  <RecordingSignalIndicator />
                )}

                <LiveMediaStream
                  mediaStream={props.liveMediaStream}
                  obsConnectorState={props.obsConnectorState}
                  speechDetectorState={props.speechDetectorState}
                />
              </div>
            )}
            <div className={cn(!shouldShowVideoPlayer && "hidden")}>
              <PreloadableClipManager
                clipsToAggressivelyPreload={clipsToAggressivelyPreload}
                clips={props.clips
                  .filter((clip) => state.clipIdsPreloaded.has(clip.id))
                  .filter((clip) => clip.type === "on-database")}
                finalClipId={props.clips[props.clips.length - 1]?.id}
                state={state.runningState}
                currentClipId={currentClipId}
                onClipFinished={() => {
                  dispatch({ type: "clip-finished" });
                }}
                onUpdateCurrentTime={(time) => {
                  dispatch({ type: "update-clip-current-time", time });
                }}
                playbackRate={state.playbackRate}
              />
            </div>

            <div className="flex gap-2 mt-4">
              <Button asChild variant="secondary">
                <Link to={`/?repoId=${props.repoId}#${props.lessonId}`}>
                  <ChevronLeftIcon className="w-4 h-4 mr-1" />
                  Go Back
                </Link>
              </Button>

              <exportVideoClipsFetcher.Form
                method="post"
                action={`/api/videos/${props.videoId}/export`}
              >
                <Button variant="default">
                  {exportVideoClipsFetcher.state === "submitting" ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <DownloadIcon className="w-4 h-4 mr-1" />
                  )}
                  Export
                </Button>
              </exportVideoClipsFetcher.Form>
              <OBSConnectionButton state={props.obsConnectorState} />
            </div>
          </div>
        </div>
      </div>

      {/* Clips Section - Shows second on mobile, first on desktop */}
      <div className="lg:flex-1 flex-wrap flex gap-2 h-full order-2 lg:order-1">
        <div className="flex gap-3 h-full flex-col w-full">
          {props.clips.map((clip) => {
            const duration =
              clip.type === "on-database"
                ? clip.sourceEndTime - clip.sourceStartTime
                : null;

            // const waveformData = props.waveformDataForClip[clip.id];

            const percentComplete = duration
              ? state.currentTimeInClip / duration
              : 0;

            return (
              <button
                key={clip.id}
                className={cn(
                  "bg-gray-800 px-4 py-2 rounded-md text-left block relative overflow-hidden w-full",
                  state.selectedClipsSet.has(clip.id) &&
                    "outline-2 outline-blue-200 bg-gray-600",
                  clip.id === currentClipId && "bg-blue-900"
                )}
                onClick={(e) => {
                  dispatch({
                    type: "click-clip",
                    clipId: clip.id,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                  });
                }}
              >
                {/* Moving bar indicator */}
                {clip.id === currentClipId && (
                  <div
                    className="absolute top-0 left-0 w-full h-full bg-blue-700 z-0"
                    style={{
                      width: `${percentComplete * 100}%`,
                      height: "100%",
                    }}
                  />
                )}
                {/* {waveformData && (
                  <div className="absolute bottom-0 left-0 w-full h-full flex items-end z-0">
                    {waveformData.map((data, index) => {
                      return (
                        <div
                          key={index}
                          style={{ height: `${data * 120}px`, width: "0.5%" }}
                          className={cn(
                            "z-0",
                            "bg-gray-700",
                            clip.id === currentClipId && "bg-blue-800"
                          )}
                        />
                      );
                    })}
                  </div>
                )} */}
                <span className="z-10 block relative text-white text-sm mr-6 leading-6">
                  {props.clipIdsBeingTranscribed.has(clip.id) &&
                    clip.type === "on-database" &&
                    !clip.transcribedAt &&
                    !clip.text && (
                      <div className="flex items-center">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin text-gray-300" />
                        <span className="text-gray-400">Transcribing...</span>
                      </div>
                    )}
                  {clip.type === "on-database" ? (
                    clip.text
                  ) : (
                    <div className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin text-gray-300" />
                      <span className="text-gray-400">
                        Detecting silence...
                      </span>
                    </div>
                  )}
                </span>
                {/* <Button
                className="z-10 relative"
                onClick={() => {
                  setClips(clips.filter((c) => c.id !== clip.id));

                  if (clip.id === currentClipId) {
                    if (nextClip) {
                      setCurrentClipId(nextClip.id);
                    } else if (previousClip) {
                      setCurrentClipId(previousClip.id);
                    }
                  }
                }}
              >
                Delete
              </Button> */}
                {duration && (
                  <div
                    className={cn(
                      "absolute top-0 right-0 text-xs mt-1 mr-2 text-gray-500",
                      clip.id === currentClipId && "text-blue-200",
                      state.selectedClipsSet.has(clip.id) && "text-gray-300"
                    )}
                  >
                    {formatSecondsToTime(duration)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const formatSecondsToTime = (seconds: number) => {
  return seconds.toFixed(1) + "s";
};

export const LiveMediaStream = (props: {
  mediaStream: MediaStream;
  obsConnectorState: OBSConnectionState;
  speechDetectorState: FrontendSpeechDetectorState;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = props.mediaStream;
      videoRef.current.play();
    }
  }, [props.mediaStream, videoRef.current]);

  const isRecording = props.obsConnectorState.type === "obs-recording";

  return (
    <div className={cn("relative")}>
      {isRecording && props.speechDetectorState.type === "silence" && (
        <div className="absolute top-4 left-4 bg-blue-600 rounded-full size-8 flex items-center justify-center">
          <CheckIcon className="size-4 text-white" />
        </div>
      )}
      {isRecording &&
        props.speechDetectorState.type === "speaking-detected" && (
          <div className="absolute top-4 left-4 bg-yellow-600 rounded-full size-8 flex items-center justify-center">
            <MicIcon className="size-4 text-white" />
          </div>
        )}
      {isRecording &&
        props.speechDetectorState.type ===
          "long-enough-speaking-for-clip-detected" && (
          <div className="absolute top-4 left-4 bg-green-600 rounded-full size-8 flex items-center justify-center">
            <MicIcon className="size-4 text-white" />
          </div>
        )}
      {isRecording && props.speechDetectorState.type === "warming-up" && (
        <div className="absolute top-4 left-4 bg-red-600 rounded-full size-8 flex items-center justify-center">
          <Loader2 className="size-4 text-white animate-spin" />
        </div>
      )}
      {!isRecording && (
        <div className="absolute top-4 left-4 bg-gray-300 rounded-full size-8 flex items-center justify-center">
          <MicOffIcon className="size-4 text-gray-900" />
        </div>
      )}

      <video
        ref={videoRef}
        muted
        className={cn(
          "outline-4",
          "outline-gray-300",
          "rounded-lg",
          isRecording &&
            props.speechDetectorState.type === "speaking-detected" &&
            "outline-yellow-600",
          isRecording &&
            props.speechDetectorState.type ===
              "long-enough-speaking-for-clip-detected" &&
            "outline-green-600",
          isRecording &&
            props.speechDetectorState.type === "silence" &&
            "outline-blue-600",
          isRecording &&
            props.speechDetectorState.type === "warming-up" &&
            "outline-red-600"
        )}
      />
    </div>
  );
};

export const RecordingSignalIndicator = () => {
  return (
    <div className="absolute top-6 right-6 flex items-center justify-center">
      <div className="w-10 h-10 bg-red-700 rounded-full animate-pulse" />
    </div>
  );
};
