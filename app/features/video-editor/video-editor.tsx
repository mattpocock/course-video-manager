import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  Loader2,
  MicOffIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { OBSConnectionButton, type OBSConnectionState } from "./obs-connector";
import { PreloadableClipManager } from "./preloadable-clip";
import { makeVideoEditorReducer, type Clip } from "./reducer";
import { TitleSection } from "./title-section";
import { formatSecondsToTimeCode } from "@/services/utils";

const useDebounceArchiveClips = () => {
  const archiveClipFetcher = useFetcher();

  const [clipsToArchive, setClipsToArchive] = useState<string[]>([]);

  useEffect(() => {
    if (clipsToArchive.length === 0) return;

    const timeout = setTimeout(() => {
      archiveClipFetcher.submit(
        { clipIds: clipsToArchive },
        {
          method: "POST",
          action: "/clips/archive",
          encType: "application/json",
        }
      );
      setClipsToArchive([]);
    }, 500);
    return () => clearTimeout(timeout);
  }, [clipsToArchive]);

  return {
    setClipsToArchive: (clipIds: string[]) => {
      setClipsToArchive([...clipsToArchive, ...clipIds]);
    },
  };
};

export const VideoEditor = (props: {
  obsConnectorState: OBSConnectionState;
  initialClips: Clip[];
  videoPath: string;
  lessonPath: string;
  repoName: string;
  repoId: string;
  lessonId: string;
  videoId: string;
  isImporting: boolean;
  liveMediaStream: MediaStream | null;
  speechDetectorState: SpeechDetectorState;
}) => {
  const { setClipsToArchive } = useDebounceArchiveClips();

  const [state, dispatch] = useReducer(
    makeVideoEditorReducer((effect) => {
      if (effect.type === "archive-clips") {
        setClipsToArchive(effect.clipIds);
      }
    }),
    {
      forceViewTimeline: false,
      runningState: "paused",
      clips: props.initialClips,
      currentClipId: props.initialClips[0]?.id ?? "",
      currentTimeInClip: 0,
      selectedClipsSet: new Set<string>(),
      clipIdsPreloaded: new Set<string>(
        [props.initialClips[0]?.id, props.initialClips[1]?.id].filter(
          (id) => id !== undefined
        )
      ),
      playbackRate: 1,
    }
  );

  useEffect(() => {
    dispatch({ type: "clips-updated-from-props", clips: props.initialClips });
  }, [props.initialClips]);

  const currentClipIndex = state.clips.findIndex(
    (clip) => clip.id === state.currentClipId
  );

  const nextClip = state.clips[currentClipIndex + 1];

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

  const totalDuration = state.clips.reduce((acc, clip) => {
    return acc + (clip.sourceEndTime - clip.sourceStartTime);
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
                  "w-full h-full relative",
                  shouldShowVideoPlayer && "hidden"
                )}
              >
                {props.obsConnectorState.type === "obs-recording" && (
                  <RecordingSignalIndicator />
                )}

                <LiveMediaStream
                  mediaStream={props.liveMediaStream}
                  speechDetectorState={props.speechDetectorState}
                />
              </div>
            )}
            <div className={cn(!shouldShowVideoPlayer && "hidden")}>
              <PreloadableClipManager
                clipsToAggressivelyPreload={clipsToAggressivelyPreload}
                clips={state.clips.filter((clip) =>
                  state.clipIdsPreloaded.has(clip.id)
                )}
                finalClipId={
                  props.initialClips[props.initialClips.length - 1]?.id
                }
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
              <OBSConnectionButton
                state={props.obsConnectorState}
                isImporting={props.isImporting}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Clips Section - Shows second on mobile, first on desktop */}
      <div className="lg:flex-1 flex-wrap flex gap-2 h-full order-2 lg:order-1">
        <div className="flex gap-3 h-full flex-col">
          {state.clips.map((clip) => {
            const duration = clip.sourceEndTime - clip.sourceStartTime;

            // const waveformData = props.waveformDataForClip[clip.id];

            const percentComplete = state.currentTimeInClip / duration;

            return (
              <button
                key={clip.id}
                className={cn(
                  "bg-gray-800 px-4 py-2 rounded-md text-left block relative overflow-hidden",
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
                  {clip.text}
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
                <div
                  className={cn(
                    "absolute top-0 right-0 text-xs mt-1 mr-2 text-gray-500",
                    clip.id === currentClipId && "text-blue-200"
                  )}
                >
                  {formatSecondsToTime(
                    clip.sourceEndTime - clip.sourceStartTime
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {props.isImporting && (
          <div className="text-sm text-muted-foreground flex justify-center items-center w-full mt-4">
            <Loader2 className="w-6 h-6 mr-2 animate-spin" />
            <span>Appending video from OBS...</span>
          </div>
        )}
      </div>
    </div>
  );
};

const formatSecondsToTime = (seconds: number) => {
  return seconds.toFixed(1) + "s";
};

export const LiveMediaStream = (props: {
  mediaStream: MediaStream;
  speechDetectorState: SpeechDetectorState;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = props.mediaStream;
      videoRef.current.play();
    }
  }, [props.mediaStream, videoRef.current]);

  return (
    <div className="relative">
      {props.speechDetectorState.type === "long-enough-silence-detected" && (
        <div className="absolute top-4 left-4 bg-blue-600 rounded-full size-8 flex items-center justify-center">
          <CheckIcon className="w-4 h-4 text-white" />
        </div>
      )}
      <video ref={videoRef} muted />
    </div>
  );
};

type SpeechDetectorState =
  | {
      type: "initial-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "long-enough-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "no-silence-detected";
    };

const SPEAKING_THRESHOLD = -33;
const LONG_ENOUGH_TIME_IN_MILLISECONDS = 800;

export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
}) => {
  const [state, setState] = useState<SpeechDetectorState>({
    type: "no-silence-detected",
  });

  useEffect(() => {
    if (opts.isRecording) {
      setState({
        type: "no-silence-detected",
      });
    }
  }, [opts.isRecording]);

  useEffect(() => {
    if (!opts.mediaStream) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(opts.mediaStream);
    const processor = audioContext.createScriptProcessor(1024, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer;
      const inputData = inputBuffer.getChannelData(0); // Get the first channel

      // Calculate RMS (Root Mean Square) volume
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i]! * inputData[i]!;
      }
      const rms = Math.sqrt(sum / inputData.length);

      // Convert to decibels (dB)
      const volumeDb = 20 * Math.log10(rms + 1e-10); // Add small value to avoid log(0)

      switch (state.type) {
        case "no-silence-detected": {
          if (volumeDb < SPEAKING_THRESHOLD) {
            setState({
              type: "initial-silence-detected",
              silenceStartTime: e.timeStamp,
            });
          }
          break;
        }
        case "initial-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
            });
          } else if (
            e.timeStamp - state.silenceStartTime >
            LONG_ENOUGH_TIME_IN_MILLISECONDS
          ) {
            setState({
              type: "long-enough-silence-detected",
              silenceStartTime: e.timeStamp,
            });
          }

          break;
        }
        case "long-enough-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({ type: "no-silence-detected" });
          }
          break;
        }
      }
    };

    return () => {
      source.disconnect();
      processor.disconnect();
      audioContext.close();
    };
  }, [opts.mediaStream, state]);

  return state;
};

export const RecordingSignalIndicator = () => {
  return (
    <div className="absolute top-6 right-6 flex items-center justify-center">
      <div className="w-10 h-10 bg-red-700 rounded-full animate-pulse" />
    </div>
  );
};
