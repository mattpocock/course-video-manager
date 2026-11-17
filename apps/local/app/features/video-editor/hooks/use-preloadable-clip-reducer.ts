import { useCallback, useRef, type RefObject } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialPreloadableClipState,
  preloadableClipReducer,
} from "../preloadable-clip-reducer";

/**
 * A preloaded Clip's effect runner for `preloadableClipReducer`. The effects
 * act on the Clip's `<video>`.
 *
 * `reportPlayhead` dispatches `playhead-moved` only when the time differs from
 * the last one reported: the `<video>` is read on every animation frame, and
 * every dispatch re-renders the Clip, even one whose `<video>` sits paused
 * off-screen.
 */
export function usePreloadableClipReducer(
  video: RefObject<HTMLVideoElement | null>,
  onPreloadComplete: () => void
) {
  const [state, dispatch] = useEffectReducer<
    preloadableClipReducer.State,
    preloadableClipReducer.Action,
    preloadableClipReducer.Effect
  >(preloadableClipReducer, createInitialPreloadableClipState(), {
    "park-video": (_state, effect) => {
      const element = video.current;
      if (!element) return;
      element.pause();
      element.muted = false;
      element.currentTime = effect.at;
    },
    "report-preload-complete": () => {
      onPreloadComplete();
    },
  });

  const lastPlayhead = useRef(state.overlayTime);
  const reportPlayhead = useCallback(
    (clipTime: number) => {
      if (lastPlayhead.current === clipTime) return;
      lastPlayhead.current = clipTime;
      dispatch({ type: "playhead-moved", clipTime });
    },
    [dispatch]
  );

  return { state, dispatch, reportPlayhead };
}
