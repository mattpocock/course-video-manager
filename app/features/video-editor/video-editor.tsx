import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, DownloadIcon, Loader2 } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { Link, useFetcher } from "react-router";
import { OBSConnectionButton, useOBSConnector } from "./obs-connector";
import { PreloadableClipManager } from "./preloadable-clip";
import { makeVideoEditorReducer, type Clip } from "./reducer";
import { TitleSection } from "./title-section";

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
  initialClips: Clip[];
  videoPath: string;
  lessonPath: string;
  repoName: string;
  repoId: string;
  lessonId: string;
  videoId: string;
}) => {
  const { setClipsToArchive } = useDebounceArchiveClips();

  const [state, dispatch] = useReducer(
    makeVideoEditorReducer((effect) => {
      if (effect.type === "archive-clips") {
        setClipsToArchive(effect.clipIds);
      }
    }),
    {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const obsConnector = useOBSConnector(props.videoId);

  const exportVideoClipsFetcher = useFetcher();

  return (
    <div className="flex gap-6">
      <div className="flex-1 p-6 flex-wrap flex gap-2 h-full">
        <div className="mb-6">
          <TitleSection
            videoPath={props.videoPath}
            lessonPath={props.lessonPath}
            repoName={props.repoName}
          />
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
            <OBSConnectionButton state={obsConnector.state} />
          </div>
        </div>
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
      </div>
      <div className="flex-1 relative p-6">
        <div className="sticky top-0">
          <PreloadableClipManager
            clipsToAggressivelyPreload={clipsToAggressivelyPreload}
            clips={state.clips.filter((clip) =>
              state.clipIdsPreloaded.has(clip.id)
            )}
            finalClipId={props.initialClips[props.initialClips.length - 1]?.id}
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
      </div>
    </div>
  );
};

const formatSecondsToTime = (seconds: number) => {
  return seconds.toFixed(1) + "s";
};
