import { useEffectReducer } from "use-effect-reducer";
import type {
  Clip,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "../clip-state-reducer";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "../video-state-reducer";

export const useVideoEditor = (props: {
  items: TimelineItem[];
  clips: Clip[];
  insertionPoint: FrontendInsertionPoint;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  onTogglePauseForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    chapterIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
}) => {
  const [state, dispatch] = useEffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  >(
    makeVideoEditorReducer(
      props.items.map((item) => item.frontendId),
      props.clips.map((clip) => clip.frontendId)
    ),
    {
      showLastFrameOfVideo: true,
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
      scrubSeekTime: undefined,
    },
    {
      "archive-clips": (_state, effect, _dispatch) => {
        props.onClipsRemoved(effect.clipIds);
      },
      "retranscribe-clips": (_state, effect, _dispatch) => {
        props.onClipsRetranscribe(effect.clipIds);
      },
      "toggle-pause-for-clip": (_state, effect, _dispatch) => {
        props.onTogglePauseForClip(effect.clipId);
      },
      "move-clip": (_state, effect, _dispatch) => {
        props.onMoveClip(effect.clipId, effect.direction);
      },
      "create-video-from-selection": (_state, effect, _dispatch) => {
        props.onCreateVideoFromSelection(
          effect.clipIds,
          effect.chapterIds,
          effect.title,
          effect.mode
        );
      },
    }
  );

  return {
    state,
    dispatch,
  };
};
