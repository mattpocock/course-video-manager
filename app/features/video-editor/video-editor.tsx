import { AddVideoModal } from "@/components/add-video-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import levenshtein from "js-levenshtein";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDown,
  ChevronLeftIcon,
  CircleQuestionMarkIcon,
  Columns2,
  CopyIcon,
  DownloadIcon,
  FilmIcon,
  Loader2,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PencilIcon,
  Plus,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { streamDeckForwarderMessageSchema } from "stream-deck-forwarder/stream-deck-forwarder-types";
import { useEffectReducer } from "use-effect-reducer";
import type { Clip, FrontendId } from "./clip-state-reducer";
import { type OBSConnectionState } from "./obs-connector";
import { PreloadableClipManager } from "./preloadable-clip";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "./video-state-reducer";

function calculateTextSimilarity(str1: string, str2: string): number {
  const distance = levenshtein(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  // Handle edge case of empty strings
  if (maxLength === 0) return 100;

  const similarity = (1 - distance / maxLength) * 100;
  return Math.max(0, Math.round(similarity * 100) / 100); // Round to 2 decimal places
}

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
  hasExplainerFolder: boolean;
  videoCount: number;
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
      "archive-clips": (_state, effect, _dispatch) => {
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
  const exportToDavinciResolveFetcher = useFetcher();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isAddVideoModalOpen, setIsAddVideoModalOpen] = useState(false);

  const copyTranscriptToClipboard = async () => {
    try {
      // Get all clips with text and concatenate them
      const transcript = props.clips
        .filter((clip) => clip.type === "on-database")
        .map((clip) => clip.text)
        .join(" ");

      await navigator.clipboard.writeText(transcript);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy transcript to clipboard:", error);
    }
  };

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

  const allClipsHaveSilenceDetected = props.clips.every(
    (clip) => clip.type === "on-database"
  );

  const allClipsHaveText = props.clips.every(
    (clip) => clip.type === "on-database" && clip.text
  );

  let timecode = 0;

  const clipsWithTimecodeAndLevenshtein = useMemo(
    () =>
      props.clips.map((clip, index, clips) => {
        if (clip.type === "optimistically-added") return clip;

        const nextClip = clips[index + 1];

        const nextLevenshtein =
          nextClip?.type === "on-database" && nextClip?.text
            ? calculateTextSimilarity(clip.text, nextClip.text)
            : 0;

        const timecodeString = formatSecondsToTimeCode(timecode);

        const duration = clip.sourceEndTime - clip.sourceStartTime;
        timecode += duration;
        return {
          ...clip,
          nextLevenshtein,
          timecode: timecodeString,
        };
      }),
    [props.clips]
  );

  const areAnyClipsDangerous = clipsWithTimecodeAndLevenshtein.some((clip) => {
    return (
      clip.type === "on-database" &&
      clip.nextLevenshtein > DANGEROUS_TEXT_SIMILARITY_THRESHOLD
    );
  });

  return (
    <div className="flex flex-col lg:flex-row p-6 gap-6 gap-y-10">
      {/* Video Player Section - Shows first on mobile, second on desktop */}
      <div className="lg:flex-1 relative order-1 lg:order-2">
        <div className="sticky top-6">
          <div className="">
            <div className="mb-4">
              <h1 className="text-2xl font-bold mb-1 flex items-center">
                {props.videoPath}
                {" (" + formatSecondsToTimeCode(totalDuration) + ")"}
                {areAnyClipsDangerous && (
                  <span className="text-orange-500 ml-4 text-base font-medium inline-flex items-center">
                    <AlertTriangleIcon className="size-6 mr-2" />
                    Possible duplicate clips
                  </span>
                )}
              </h1>
              <h2 className="text-sm font-medium mb-1">
                {props.repoName}
                {" - "}
                {props.lessonPath}
              </h2>
            </div>

            {props.liveMediaStream && (
              <div
                className={cn(
                  "w-full h-full relative aspect-[16/9]",
                  (props.obsConnectorState.type === "obs-connected" ||
                    props.obsConnectorState.type === "obs-recording") &&
                    props.obsConnectorState.profile === "TikTok" &&
                    "w-92 aspect-[9/16]",
                  "hidden",
                  (viewMode === "live-stream" || viewMode === "last-frame") &&
                    "block"
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
                {lastDatabaseClip && viewMode === "last-frame" && (
                  <div
                    className={cn(
                      "absolute top-0 left-0 rounded-lg",
                      lastDatabaseClip.profile === "TikTok" &&
                        "w-92 aspect-[9/16]"
                    )}
                  >
                    <img
                      className="w-full h-full rounded-lg opacity-50"
                      src={`/clips/${lastDatabaseClip.databaseId}/last-frame`}
                    />
                  </div>
                )}
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

            <div className="flex gap-2 mt-4">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild={allClipsHaveSilenceDetected}
                      variant="secondary"
                      aria-label="Go Back"
                      disabled={!allClipsHaveSilenceDetected}
                    >
                      {allClipsHaveSilenceDetected ? (
                        <Link to={`/?repoId=${props.repoId}#${props.lessonId}`}>
                          <ChevronLeftIcon className="w-4 h-4" />
                        </Link>
                      ) : (
                        <span>
                          <ChevronLeftIcon className="w-4 h-4" />
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {!allClipsHaveSilenceDetected && (
                    <TooltipContent>
                      <p>Waiting for silence detection to complete</p>
                    </TooltipContent>
                  )}
                </Tooltip>

                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="secondary"
                            disabled={!allClipsHaveSilenceDetected}
                          >
                            {exportVideoClipsFetcher.state === "submitting" ||
                            exportToDavinciResolveFetcher.state ===
                              "submitting" ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : null}
                            Actions
                            <ChevronDown className="w-4 h-4 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                      </span>
                    </TooltipTrigger>
                    {!allClipsHaveSilenceDetected && (
                      <TooltipContent>
                        <p>Waiting for silence detection to complete</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem asChild>
                      <Link to={`/videos/${props.videoId}/write`}>
                        <PencilIcon className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Write Article</span>
                          <span className="text-xs text-muted-foreground">
                            Go to article writing interface
                          </span>
                        </div>
                      </Link>
                    </DropdownMenuItem>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <DropdownMenuItem
                            disabled={!allClipsHaveText}
                            onSelect={copyTranscriptToClipboard}
                          >
                            {isCopied ? (
                              <CheckIcon className="w-4 h-4 mr-2" />
                            ) : (
                              <CopyIcon className="w-4 h-4 mr-2" />
                            )}
                            <div className="flex flex-col">
                              <span className="font-medium">
                                Copy Transcript
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Copy all transcript to clipboard
                              </span>
                            </div>
                          </DropdownMenuItem>
                        </div>
                      </TooltipTrigger>
                      {!allClipsHaveText && (
                        <TooltipContent side="left">
                          <p>Waiting for transcription to complete</p>
                        </TooltipContent>
                      )}
                    </Tooltip>

                    <Dialog
                      open={isExportModalOpen}
                      onOpenChange={setIsExportModalOpen}
                    >
                      <DialogTrigger asChild>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                          <DownloadIcon className="w-4 h-4 mr-2" />
                          <div className="flex flex-col">
                            <span className="font-medium">Export</span>
                            <span className="text-xs text-muted-foreground">
                              Export video clips to file
                            </span>
                          </div>
                        </DropdownMenuItem>
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
                            await exportVideoClipsFetcher.submit(
                              e.currentTarget
                            );
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
                              If provided, the video will be queued for YouTube
                              and TikTok under the given title.
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
                              {exportVideoClipsFetcher.state ===
                              "submitting" ? (
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

                    <DropdownMenuItem
                      onSelect={() => {
                        exportToDavinciResolveFetcher.submit(null, {
                          method: "post",
                          action: `/videos/${props.videoId}/export-to-davinci-resolve`,
                        });
                      }}
                    >
                      <FilmIcon className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span className="font-medium">DaVinci Resolve</span>
                        <span className="text-xs text-muted-foreground">
                          Create a new timeline with clips
                        </span>
                      </div>
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onSelect={() => {
                        setIsAddVideoModalOpen(true);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      <div className="flex flex-col">
                        <span className="font-medium">Add New Video</span>
                        <span className="text-xs text-muted-foreground">
                          Add another video to this lesson
                        </span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>

      <AddVideoModal
        lessonId={props.lessonId}
        videoCount={props.videoCount}
        hasExplainerFolder={props.hasExplainerFolder}
        open={isAddVideoModalOpen}
        onOpenChange={setIsAddVideoModalOpen}
      />

      {/* Clips Section - Shows second on mobile, first on desktop */}
      <div className="lg:flex-1 flex-wrap flex gap-2 h-full order-2 lg:order-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(400px,1fr))] gap-4 w-full p-2">
          {props.clips.length === 0 && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
                <CircleQuestionMarkIcon className="size-6" />
                Pre-recording checklist
              </h2>
              <ol className="space-y-3 text-base">
                <li className="flex items-center gap-3">
                  <MicIcon className="size-5 flex-shrink-0 text-gray-300" />
                  <span>Turn the microphone all the way up</span>
                </li>
                <li className="flex items-center gap-3">
                  <MonitorIcon className="size-5 flex-shrink-0 text-gray-300" />
                  <span>Close the windows</span>
                </li>
                <li className="flex items-center gap-3">
                  <Columns2 className="size-5 flex-shrink-0 text-gray-300" />
                  <span>Close the blinds</span>
                </li>
                <li className="flex items-center gap-3">
                  <UserRound className="size-5 flex-shrink-0 text-gray-300" />
                  <span>Check bookshelf books are standing up properly</span>
                </li>
              </ol>
            </div>
          )}
          {clipsWithTimecodeAndLevenshtein.map((clip) => {
            const duration =
              clip.type === "on-database"
                ? clip.sourceEndTime - clip.sourceStartTime
                : null;

            const percentComplete = duration
              ? state.currentTimeInClip / duration
              : 0;

            const isPortrait =
              clip.type === "on-database" &&
              (clip.profile === "TikTok" || clip.profile === "Portrait");

            return (
              <button
                key={clip.frontendId}
                className={cn(
                  "bg-gray-800 rounded-md text-left relative overflow-hidden allow-keydown flex",
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
                {/* Thumbnail image */}
                {clip.type === "on-database" ? (
                  <div className="flex-shrink-0 relative">
                    <img
                      src={`/clips/${clip.databaseId}/first-frame`}
                      alt="First frame"
                      className={cn(
                        "rounded object-cover h-full object-center",
                        isPortrait
                          ? "w-24 aspect-[9/16]"
                          : "w-32 aspect-[16/9]",
                        props.clipIdsBeingTranscribed.has(clip.frontendId) &&
                          "opacity-50 grayscale"
                      )}
                    />
                    {/* Loading spinner overlay */}
                    {props.clipIdsBeingTranscribed.has(clip.frontendId) && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-white" />
                      </div>
                    )}
                    {/* Timecode overlay on image */}
                    <div
                      className={cn(
                        "absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded bg-black/60 text-gray-100",
                        clip.frontendId === currentClipId && "text-blue-100",
                        state.selectedClipsSet.has(clip.frontendId) &&
                          "text-white"
                      )}
                    >
                      {clip.timecode}
                    </div>
                  </div>
                ) : (
                  <div className="flex-shrink-0 relative w-32 aspect-[16/9] bg-gray-700 rounded flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                )}

                {/* Content area */}
                <div className="flex-1 flex flex-col min-w-0 relative p-3">
                  {/* Progress bar overlay on text */}
                  {clip.frontendId === currentClipId && (
                    <div
                      className="absolute top-0 left-0 h-full bg-blue-700 z-0 rounded"
                      style={{
                        width: `${percentComplete * 100}%`,
                      }}
                    />
                  )}

                  {/* Transcript text */}
                  <div className="z-10 relative text-white text-sm leading-6">
                    {props.clipIdsBeingTranscribed.has(clip.frontendId) ? (
                      clip.type === "on-database" &&
                      !clip.transcribedAt &&
                      !clip.text && (
                        <span className="text-gray-400">Transcribing...</span>
                      )
                    ) : clip.type === "on-database" ? (
                      <>
                        {clip.nextLevenshtein >
                          DANGEROUS_TEXT_SIMILARITY_THRESHOLD && (
                          <span className="text-orange-500 mr-2 text-base font-semibold inline-flex items-center">
                            <AlertTriangleIcon className="w-4 h-4 mr-2" />
                            {clip.nextLevenshtein.toFixed(0)}%
                          </span>
                        )}
                        <span
                          className={cn(
                            "text-gray-100",
                            clip.frontendId === currentClipId && "text-white"
                          )}
                        >
                          {clip.text}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">
                        Detecting silence...
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
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

const DANGEROUS_TEXT_SIMILARITY_THRESHOLD = 40;
