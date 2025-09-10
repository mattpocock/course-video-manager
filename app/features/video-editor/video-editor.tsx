import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, Loader2, PlusIcon } from "lucide-react";
import { useEffect, useReducer } from "react";
import { Link, useFetcher } from "react-router";
import { PreloadableClipManager } from "./preloadable-clip";
import { makeVideoEditorReducer, type Clip } from "./reducer";
import { TitleSection } from "./title-section";

export const VideoEditor = (props: {
  initialClips: Clip[];
  waveformDataForClip: Record<string, number[]>;
  videoPath: string;
  lessonPath: string;
  repoName: string;
  repoId: string;
  lessonId: string;
  videoId: string;
}) => {
  const archiveClipFetcher = useFetcher();

  const [state, dispatch] = useReducer(
    makeVideoEditorReducer((effect) => {
      if (effect.type === "archive-clips") {
        archiveClipFetcher.submit(
          { clipIds: effect.clipIds },
          {
            method: "POST",
            action: "/clips/archive",
          }
        );
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
      console.log("handleKeyDown", e.key);
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

  const appendFromOBSFetcher = useFetcher();

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
            <appendFromOBSFetcher.Form
              method="post"
              action={`/videos/${props.videoId}/append-from-obs`}
            >
              <Button variant="default">
                {appendFromOBSFetcher.state === "submitting" ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <PlusIcon className="w-4 h-4 mr-1" />
                )}
                Append From OBS
              </Button>
            </appendFromOBSFetcher.Form>
          </div>
        </div>
        <div className="flex-wrap flex gap-2 h-full">
          {state.clips.map((clip) => {
            const duration = clip.sourceEndTime - clip.sourceStartTime;

            const waveformData = props.waveformDataForClip[clip.id];

            const percentComplete = state.currentTimeInClip / duration;

            return (
              <button
                key={clip.id}
                style={{ width: `${duration * 50}px` }}
                className={cn(
                  "bg-gray-800 p-2 rounded-md text-left block relative overflow-hidden h-12",
                  state.selectedClipsSet.has(clip.id) &&
                    "outline-2 outline-blue-200 bg-gray-600",
                  clip.id === currentClipId && "bg-blue-500"
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
                    className="absolute top-0 left-0 w-full h-full bg-blue-400 z-0"
                    style={{
                      width: `${percentComplete * 100}%`,
                      height: "100%",
                    }}
                  />
                )}
                {waveformData && (
                  <div className="absolute bottom-0 left-0 w-full h-full flex items-end z-0">
                    {waveformData.map((data, index) => {
                      return (
                        <div
                          key={index}
                          style={{ height: `${data * 120}px`, width: "0.5%" }}
                          className="bg-blue-300 z-0"
                        />
                      );
                    })}
                  </div>
                )}
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
