import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import {
  CheckIcon,
  ChevronLeftIcon,
  CircleQuestionMarkIcon,
  Columns2,
  DownloadIcon,
  EyeIcon,
  Loader2,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  UserRound,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { streamDeckForwarderMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";
import type { Clip, FrontendId } from "./clip-state-reducer";
import { OBSConnectionButton, type OBSConnectionState } from "./obs-connector";
import { PreloadableClipManager } from "./preloadable-clip";
import { TitleSection } from "./title-section";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "./video-state-reducer";
import { useEffectReducer } from "use-effect-reducer";

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
  clipIdsBeingTranscribed: Set<FrontendId>;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
}) => {
  const [state, dispatch] = useEffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  >(
    makeVideoEditorReducer(props.clips.map((clip) => clip.frontendId)),
    {
      showLastFrameOfVideo: false,
      runningState: "paused",
      currentClipId: props.clips[0]?.frontendId,
      currentTimeInClip: 0,
      selectedClipsSet: new Set<FrontendId>(),
      clipIdsPreloaded: new Set<FrontendId>(
        [props.clips[0]?.frontendId, props.clips[1]?.frontendId].filter(
          (id) => id !== undefined
        )
      ),
      playbackRate: 1,
    },
    {
      "archive-clips": (state, effect, dispatch) => {
        props.onClipsRemoved(effect.clipIds);
      },
    }
  );

  const currentClipIndex = props.clips.findIndex(
    (clip) => clip.frontendId === state.currentClipId
  );

  const nextClip = props.clips[currentClipIndex + 1];

  const selectedClipId = Array.from(state.selectedClipsSet)[0];

  const clipsToAggressivelyPreload = [
    state.currentClipId,
    nextClip?.frontendId,
    selectedClipId,
  ].filter((id) => id !== undefined) as FrontendId[];

  const currentClipId = state.currentClipId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLButtonElement &&
          !e.target.classList.contains("allow-keydown"))
      ) {
        return;
      }
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:5172");
    socket.addEventListener("message", (event) => {
      const data = streamDeckForwarderMessageSchema.parse(
        JSON.parse(event.data)
      );
      if (data.type === "delete-last-clip") {
        dispatch({ type: "delete-last-clip" });
      } else if (data.type === "toggle-last-frame-of-video") {
        dispatch({ type: "toggle-last-frame-of-video" });
      }
    });
    return () => {
      socket.close();
    };
  }, []);

  const exportVideoClipsFetcher = useFetcher();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const totalDuration = props.clips.reduce((acc, clip) => {
    if (clip.type === "on-database") {
      return acc + (clip.sourceEndTime - clip.sourceStartTime);
    }
    return acc;
  }, 0);

  let viewMode: "video-player" | "live-stream" | "last-frame" = "video-player";

  if (state.showLastFrameOfVideo) {
    viewMode = "last-frame";
  } else if (!props.liveMediaStream || state.runningState === "playing") {
    viewMode = "video-player";
  } else {
    viewMode = "live-stream";
  }

  const lastDatabaseClip = props.clips.findLast(
    (clip) => clip.type === "on-database"
  );

  const currentClip = props.clips.find(
    (clip) => clip.frontendId === currentClipId
  );

  let timecode = 0;

  const clipsWithTimecode = props.clips.map((clip) => {
    if (clip.type === "optimistically-added") return clip;

    const timecodeString = formatSecondsToTimeCode(timecode);

    const duration = clip.sourceEndTime - clip.sourceStartTime;
    timecode += duration;
    return {
      ...clip,
      timecode: timecodeString,
    };
  });

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
                    props.obsConnectorState.type === "obs-recording") &&
                    props.obsConnectorState.profile === "TikTok" &&
                    "w-92 aspect-[9/16]",
                  viewMode !== "live-stream" && "hidden"
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
            <div className={cn(viewMode !== "video-player" && "hidden")}>
              <PreloadableClipManager
                clipsToAggressivelyPreload={clipsToAggressivelyPreload}
                clips={props.clips
                  .filter((clip) => state.clipIdsPreloaded.has(clip.frontendId))
                  .filter((clip) => clip.type === "on-database")}
                finalClipId={props.clips[props.clips.length - 1]?.frontendId}
                state={state.runningState}
                currentClipId={currentClipId}
                currentClipProfile={currentClip?.profile ?? undefined}
                onClipFinished={() => {
                  dispatch({ type: "clip-finished" });
                }}
                onUpdateCurrentTime={(time) => {
                  dispatch({ type: "update-clip-current-time", time });
                }}
                playbackRate={state.playbackRate}
              />
            </div>
            {lastDatabaseClip && (
              <div
                className={cn(
                  viewMode !== "last-frame" && "hidden",
                  "relative",
                  lastDatabaseClip.profile === "TikTok" && "w-92 aspect-[9/16]"
                )}
              >
                <img
                  className="w-full h-full rounded-lg outline-4 outline-orange-500"
                  src={`/clips/${lastDatabaseClip.databaseId}/last-frame`}
                />
                <div className="absolute top-4 left-4 bg-orange-500 rounded-full size-8 flex items-center justify-center">
                  <EyeIcon className="size-4 text-white" />
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <Button asChild variant="secondary">
                <Link to={`/?repoId=${props.repoId}#${props.lessonId}`}>
                  <ChevronLeftIcon className="w-4 h-4 mr-1" />
                  Go Back
                </Link>
              </Button>

              <Dialog
                open={isExportModalOpen}
                onOpenChange={setIsExportModalOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="default">
                    <DownloadIcon className="w-4 h-4 mr-1" />
                    Export
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Export</DialogTitle>
                  </DialogHeader>
                  <exportVideoClipsFetcher.Form
                    method="post"
                    action={`/api/videos/${props.videoId}/export`}
                    className="space-y-4 py-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await exportVideoClipsFetcher.submit(e.currentTarget);
                      setIsExportModalOpen(false);
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="shorts-directory-output-name">
                        Short Title
                      </Label>
                      <Input
                        id="shorts-directory-output-name"
                        placeholder="Leave empty for normal export only..."
                        name="shortsDirectoryOutputName"
                      />
                      <p className="text-xs text-muted-foreground">
                        If provided, the video will be queued for YouTube and
                        TikTok under the given title.
                      </p>
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="outline"
                        onClick={() => setIsExportModalOpen(false)}
                        type="button"
                      >
                        Cancel
                      </Button>
                      <Button type="submit">
                        {exportVideoClipsFetcher.state === "submitting" ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <DownloadIcon className="w-4 h-4 mr-1" />
                        )}
                        Export
                      </Button>
                    </div>
                  </exportVideoClipsFetcher.Form>
                </DialogContent>
              </Dialog>
              <OBSConnectionButton state={props.obsConnectorState} />
            </div>
          </div>
        </div>
      </div>

      {/* Clips Section - Shows second on mobile, first on desktop */}
      <div className="lg:flex-1 flex-wrap flex gap-2 h-full order-2 lg:order-1">
        <div className="flex gap-3 h-full flex-col w-full">
          {props.clips.length === 0 && (
            <div className="">
              <h2 className="text-lg font-bold text-gray-100 mb-1">
                No clips found
              </h2>
              <p className="text-sm">Time to start recording!</p>
            </div>
          )}
          {clipsWithTimecode.map((clip) => {
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
                key={clip.frontendId}
                className={cn(
                  "bg-gray-800 px-4 py-2 rounded-md text-left block relative overflow-hidden w-full allow-keydown",
                  state.selectedClipsSet.has(clip.frontendId) &&
                    "outline-2 outline-gray-200 bg-gray-700",
                  clip.frontendId === currentClipId && "bg-blue-900"
                )}
                onClick={(e) => {
                  dispatch({
                    type: "click-clip",
                    clipId: clip.frontendId,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                  });
                }}
              >
                {/* Moving bar indicator */}
                {clip.frontendId === currentClipId && (
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
                <span className="z-10 relative text-white text-sm mr-6 leading-6 flex items-center">
                  <div
                    className={cn(
                      "text-gray-400",
                      clip.frontendId === currentClipId && "text-blue-100"
                    )}
                  >
                    {clip.scene === "Camera" || clip.scene === "TikTok Face" ? (
                      <UserRound className="size-5 mr-4 flex-shrink-0" />
                    ) : clip.scene === "No Face" ||
                      clip.scene === "TikTok Code No Face" ? (
                      <MonitorIcon className="size-5 mr-4 flex-shrink-0" />
                    ) : clip.scene === "Code" ||
                      clip.scene === "TikTok Code" ? (
                      <Columns2 className="size-5 mr-4 flex-shrink-0" />
                    ) : (
                      <CircleQuestionMarkIcon className="size-5 mr-4 flex-shrink-0" />
                    )}
                  </div>
                  {props.clipIdsBeingTranscribed.has(clip.frontendId) &&
                    clip.type === "on-database" &&
                    !clip.transcribedAt &&
                    !clip.text && (
                      <div className="flex items-center">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin text-gray-300" />
                        <span className="text-gray-400">Transcribing...</span>
                      </div>
                    )}
                  {clip.type === "on-database" ? (
                    <span
                      className={cn(
                        "text-gray-100",
                        clip.frontendId === currentClipId && "text-white"
                      )}
                    >
                      {clip.text}
                    </span>
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
                {clip.type === "on-database" && (
                  <div
                    className={cn(
                      "absolute top-0 right-0 text-xs mt-1 mr-2 text-gray-500",
                      clip.frontendId === currentClipId && "text-blue-200",
                      state.selectedClipsSet.has(clip.frontendId) &&
                        "text-gray-300"
                    )}
                  >
                    {clip.timecode}
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
