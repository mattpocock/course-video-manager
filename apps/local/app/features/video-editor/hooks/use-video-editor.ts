import { useEffect } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type {
  Clip,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "../clip-state-reducer";
import { useDeepLinkFocus } from "@/features/entity-links/use-deep-link-focus";
import { editorDeepLinkCandidates } from "../deep-link-candidates";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "../video-state-reducer";

export const useVideoEditor = (props: {
  items: TimelineItem[];
  /** Every item, archived ones too — what a copied link may name. */
  allItems: TimelineItem[];
  clips: Clip[];
  insertionPoint: FrontendInsertionPoint;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  onTogglePauseForClip: (clipId: FrontendId) => void;
  onToggleZoomForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    chapterIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
  /** The editor's Stop for a recording Take (the CVM recorder's). */
  onStopRecording: () => void;
  /** Whether the layout plays Clips back (`videoStateReducer.State.replay`). */
  replay: boolean;
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
      animatic: null,
      replay: props.replay,
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
      "toggle-zoom-for-clip": (_state, effect, _dispatch) => {
        props.onToggleZoomForClip(effect.clipId);
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
      "stop-recording": () => {
        props.onStopRecording();
      },
    }
  );

  // The Clips live in the route's clip-state reducer; report each change so
  // this reducer can let go of a Clip that has left the timeline.
  const clipIdsKey = props.clips.map((clip) => clip.frontendId).join("\n");
  useEffect(() => {
    dispatch({
      type: "timeline-clips-changed",
      clipIds:
        clipIdsKey === "" ? [] : (clipIdsKey.split("\n") as FrontendId[]),
    });
  }, [clipIdsKey, dispatch]);

  // A copied `?clip=` / `?chapter=` link selects its item once it loads.
  useDeepLinkFocus({
    types: ["clip", "chapter"],
    candidates: editorDeepLinkCandidates(props.allItems),
    onFocus: (candidate) =>
      dispatch({
        type: "deep-link-target-found",
        itemId: candidate.key as FrontendId,
      }),
  });

  return {
    state,
    dispatch,
  };
};
