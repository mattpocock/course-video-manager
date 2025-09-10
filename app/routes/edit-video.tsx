import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  extractAudioFromVideoURL,
  getWaveformForTimeRange,
} from "@/services/video-editing";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Route } from "./+types/edit-video";

// Core data model - flat array of clips
interface Clip {
  id: string;
  inputVideo: string;
  sourceStartTime: number; // Start time in source video (seconds)
  sourceEndTime: number; // End time in source video (seconds)
}

interface ClipWithIndex extends Clip {
  index: number;
}

const getPrioritizedListOfClips = (opts: {
  clips: Clip[];
  currentClipId: string;
}): ClipWithIndex[] => {
  const { clips, currentClipId } = opts;

  const clipsWithIndex = clips.map((clip, index) => ({
    ...clip,
    index,
  }));

  const currentClipIndex = clipsWithIndex.findIndex(
    (clip) => clip.id === currentClipId
  );

  if (currentClipIndex === -1) {
    throw new Error("Current clip not found");
  }

  const currentClip = clipsWithIndex[currentClipIndex]!;
  const nextClip = clipsWithIndex[currentClipIndex + 1];
  const nextNextClip = clipsWithIndex[currentClipIndex + 2];
  const previousClip = clipsWithIndex[currentClipIndex - 1];
  const clipsBeforePreviousClip = clipsWithIndex.slice(0, currentClipIndex - 2);
  const clipsAfterNextClip = clipsWithIndex.slice(currentClipIndex + 3);

  return [
    currentClip,
    nextClip,
    nextNextClip,
    previousClip,
    ...clipsAfterNextClip,
    ...clipsBeforePreviousClip,
  ].filter((clip) => clip !== undefined);
};

type ClipState = "playing" | "paused";

const PRELOAD_PLAY_AMOUNT = 0.1;

const Clip = (props: {
  clip: Clip;
  onFinish: () => void;
  onPreloadComplete: () => void;
  hidden: boolean;
  state: ClipState;
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

    if (preloadState === "preloading") {
      ref.current.muted = true;
      ref.current.play();
      return;
    }

    if (props.hidden) {
      ref.current.pause();
      ref.current.currentTime = props.clip.sourceStartTime;
      return;
    }

    ref.current.playbackRate = 1;

    if (isPlaying) {
      ref.current.play();
    } else {
      ref.current.pause();
    }
  }, [props.hidden, ref.current, props.state, preloadState]);

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
      key={props.clip.id}
      src={`/view-video?videoPath=${props.clip.inputVideo}#t=${preloadFrom},${modifiedEndTime}`}
      className={cn(props.hidden && "hidden")}
      ref={ref}
      preload="auto"
    />
  );
};

const TimelineView = (props: {
  clips: Clip[];
  state: ClipState;
  currentClipId: string;
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
}) => {
  const prioritizedClips = getPrioritizedListOfClips({
    clips: props.clips,
    currentClipId: props.currentClipId,
  }).slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      {prioritizedClips.map((clip) => {
        const isCurrentlyPlaying = clip.id === props.currentClipId;

        const onFinish = () => {
          if (!isCurrentlyPlaying) {
            return;
          }

          console.log("onFinish", clip);

          props.onClipFinished();
        };

        return (
          <div key={clip.id}>
            <Clip
              clip={clip}
              key={clip.id}
              onFinish={onFinish}
              hidden={!isCurrentlyPlaying}
              state={props.state}
              onUpdateCurrentTime={(time) => {
                if (isCurrentlyPlaying) {
                  props.onUpdateCurrentTime(time);
                }
              }}
              onPreloadComplete={() => {
                console.log("onPreloadComplete", clip.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export const clientLoader = async () => {
  const audioBuffer = await extractAudioFromVideoURL(
    `/view-video?videoPath=${initialClips[0]!.inputVideo}`
  );

  const clipsWithWaveformData = initialClips.map((clip) => {
    const waveformDataForTimeRange = getWaveformForTimeRange(
      audioBuffer,
      clip.sourceStartTime,
      clip.sourceEndTime,
      200
    );
    return {
      ...clip,
      waveformDataForTimeRange,
    };
  });

  return { clipsWithWaveformData };
};

interface ClipWithWaveformData extends Clip {
  waveformDataForTimeRange: number[];
}

type State = {
  runningState: ClipState;
  clips: ClipWithWaveformData[];
  currentClipId: string;
  currentTimeInClip: number;
  selectedClipsSet: Set<string>;
};

type Action =
  | {
      type: "press-pause";
    }
  | {
      type: "press-play";
    }
  | {
      type: "click-clip";
      clipId: string;
      ctrlKey: boolean;
      shiftKey: boolean;
    }
  | {
      type: "update-clip-current-time";
      time: number;
    }
  | {
      type: "clip-finished";
    }
  | {
      type: "press-delete";
    }
  | {
      type: "press-space-bar";
    }
  | {
      type: "press-return";
    }
  | {
      type: "press-arrow-left";
    }
  | {
      type: "press-arrow-right";
    };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "press-space-bar":
      return {
        ...state,
        runningState: state.runningState === "playing" ? "paused" : "playing",
      };
    case "press-pause":
      return { ...state, runningState: "paused" };
    case "press-play":
      return { ...state, runningState: "playing" };
    case "press-return":
      if (state.selectedClipsSet.size === 0) {
        return state;
      }
      const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

      return {
        ...state,
        currentClipId: mostRecentClipId,
        runningState: "playing",
        currentTimeInClip: 0,
        selectedClipsSet: new Set([mostRecentClipId]),
      };
    case "click-clip":
      if (action.ctrlKey) {
        const newSelectedClipsSet = new Set(state.selectedClipsSet);
        if (newSelectedClipsSet.has(action.clipId)) {
          newSelectedClipsSet.delete(action.clipId);
        } else {
          newSelectedClipsSet.add(action.clipId);
        }
        return {
          ...state,
          selectedClipsSet: newSelectedClipsSet,
        };
      } else if (action.shiftKey) {
        const mostRecentClipId = Array.from(state.selectedClipsSet).pop();

        if (!mostRecentClipId) {
          return {
            ...state,
            selectedClipsSet: new Set([action.clipId]),
          };
        }

        const mostRecentClipIndex = state.clips.findIndex(
          (clip) => clip.id === mostRecentClipId
        );

        if (mostRecentClipIndex === -1) {
          return state;
        }

        const newClipIndex = state.clips.findIndex(
          (clip) => clip.id === action.clipId
        );

        if (newClipIndex === -1) {
          return state;
        }
        const firstIndex = Math.min(mostRecentClipIndex, newClipIndex);
        const lastIndex = Math.max(mostRecentClipIndex, newClipIndex);

        const clipsBetweenMostRecentClipIndexAndNewClipIndex =
          state.clips.slice(firstIndex, lastIndex + 1);

        return {
          ...state,
          selectedClipsSet: new Set(
            clipsBetweenMostRecentClipIndexAndNewClipIndex.map(
              (clip) => clip.id
            )
          ),
        };
      } else {
        if (state.selectedClipsSet.size > 1) {
          return {
            ...state,
            selectedClipsSet: new Set([action.clipId]),
          };
        }

        if (state.selectedClipsSet.has(action.clipId)) {
          return {
            ...state,
            selectedClipsSet: new Set(),
          };
        }
        return {
          ...state,
          selectedClipsSet: new Set([action.clipId]),
        };
      }
    case "press-delete":
      const lastClipBeingDeletedIndex = state.clips.findLastIndex((clip) => {
        return state.selectedClipsSet.has(clip.id);
      });

      if (lastClipBeingDeletedIndex === -1) {
        return state;
      }

      const clipToMoveSelectionTo = state.clips[lastClipBeingDeletedIndex + 1];
      const backupClipToMoveSelectionTo =
        state.clips[lastClipBeingDeletedIndex - 1];
      const finalBackupClipToMoveSelectionTo = state.clips[0];

      const newSelectedClipId =
        clipToMoveSelectionTo?.id ??
        backupClipToMoveSelectionTo?.id ??
        finalBackupClipToMoveSelectionTo?.id;

      const newClips = state.clips.filter(
        (clip) => !state.selectedClipsSet.has(clip.id)
      );

      const isCurrentClipDeleted = state.selectedClipsSet.has(
        state.currentClipId
      );

      return {
        ...state,
        clips: newClips,
        selectedClipsSet: new Set(
          [newSelectedClipId].filter((id) => id !== undefined)
        ),
        runningState: isCurrentClipDeleted ? "paused" : state.runningState,
        currentClipId: isCurrentClipDeleted
          ? newSelectedClipId!
          : state.currentClipId,
      };
    case "update-clip-current-time":
      return { ...state, currentTimeInClip: action.time };
    case "clip-finished": {
      const currentClipIndex = state.clips.findIndex(
        (clip) => clip.id === state.currentClipId
      );
      const nextClip = state.clips[currentClipIndex + 1];
      if (nextClip) {
        return { ...state, currentClipId: nextClip.id };
      } else {
        return { ...state, runningState: "paused" };
      }
    }
    case "press-arrow-left": {
      if (state.selectedClipsSet.size === 0) {
        return { ...state, selectedClipsSet: new Set([state.currentClipId]) };
      }

      const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

      const currentClipIndex = state.clips.findIndex(
        (clip) => clip.id === mostRecentClipId
      );
      const previousClip = state.clips[currentClipIndex - 1];
      if (previousClip) {
        return { ...state, selectedClipsSet: new Set([previousClip.id]) };
      } else {
        return state;
      }
    }
    case "press-arrow-right": {
      if (state.selectedClipsSet.size === 0) {
        return { ...state, selectedClipsSet: new Set([state.currentClipId]) };
      }

      const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

      const currentClipIndex = state.clips.findIndex(
        (clip) => clip.id === mostRecentClipId
      );
      const nextClip = state.clips[currentClipIndex + 1];
      if (nextClip) {
        return { ...state, selectedClipsSet: new Set([nextClip.id]) };
      } else {
        return state;
      }
    }
  }
  action satisfies never;
};

export default function Component(props: Route.ComponentProps) {
  const [state, dispatch] = useReducer(reducer, {
    runningState: "paused",
    clips: props.loaderData.clipsWithWaveformData,
    currentClipId: initialClips[0]!.id,
    currentTimeInClip: 0,
    selectedClipsSet: new Set<string>(),
  });

  const currentClipId = state.currentClipId;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="flex gap-6">
      <div className="flex-1 p-6 flex-wrap flex gap-2 h-full">
        {state.clips.map((clip) => {
          const duration = clip.sourceEndTime - clip.sourceStartTime;

          const waveformData = clip.waveformDataForTimeRange;

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
                {formatSecondsToTime(clip.sourceEndTime - clip.sourceStartTime)}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex-1 relative p-6">
        <div className="sticky top-0">
          <TimelineView
            clips={state.clips}
            state={state.runningState}
            currentClipId={currentClipId}
            onClipFinished={() => {
              dispatch({ type: "clip-finished" });
            }}
            onUpdateCurrentTime={(time) => {
              dispatch({ type: "update-clip-current-time", time });
            }}
          />
          <Button onClick={() => dispatch({ type: "press-play" })}>Play</Button>
          <Button onClick={() => dispatch({ type: "press-pause" })}>
            Pause
          </Button>
        </div>
      </div>
    </div>
  );
}

const VIDEO_DATA = {
  clips: [
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "2.87",
      endTime: "6.37",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "9.37",
      endTime: "13.55",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "16.95",
      endTime: "20.15",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "36.12",
      endTime: "40.58",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "46.13",
      endTime: "50.68",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "54.68",
      endTime: "60.34",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "64.83",
      endTime: "69.04",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "77.57",
      endTime: "79.62",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "94.92",
      endTime: "98.83",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "105.03",
      endTime: "107.28",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "111.50",
      endTime: "115.65",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "120.78",
      endTime: "126.41",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "131.40",
      endTime: "137.71",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "140.95",
      endTime: "143.66",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "147.10",
      endTime: "152.16",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "165.03",
      endTime: "169.79",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "177.75",
      endTime: "180.28",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "183.55",
      endTime: "185.90",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "191.57",
      endTime: "196.95",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "203.68",
      endTime: "210.43",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "218.03",
      endTime: "221.89",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "225.18",
      endTime: "230.33",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "244.77",
      endTime: "248.55",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "268.32",
      endTime: "272.53",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "275.82",
      endTime: "279.50",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "282.52",
      endTime: "288.57",
    },
    {
      inputVideo: "/mnt/d/raw-footage/2025-09-09_14-03-40.mp4",
      startTime: "303.83",
      endTime: "307.83",
    },
  ],
} as const;

const initialClips: Clip[] = VIDEO_DATA.clips
  .map((clip) => {
    return {
      ...clip,
      sourceVideoStartTime: parseFloat(clip.startTime),
      sourceVideoEndTime: parseFloat(clip.endTime),
    };
  })
  .map((clip, index) => {
    return {
      id: `clip-${index}`,
      inputVideo: clip.inputVideo,
      sourceStartTime: clip.sourceVideoStartTime,
      sourceEndTime: clip.sourceVideoEndTime,
    };
  });

// Should return 3.2s
const formatSecondsToTime = (seconds: number) => {
  return seconds.toFixed(1) + "s";
};
