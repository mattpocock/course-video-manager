import { useEffect, useRef, type RefObject } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { SceneSegment } from "@/packages/scene-layout";
import {
  compositePlaybackReducer,
  compositeScene,
  createInitialCompositePlaybackState,
  type PictureSource,
} from "./composite-playback-reducer";
import { after } from "@/packages/clock";

/**
 * The effect runner for `compositePlaybackReducer`, and the bridge from the
 * clock `<video>` (a CVM-recorder Clip's mic), the picture `<video>`s and the
 * editor into it. Returns the refs the picture `<video>`s mount on and the
 * scene to draw now. `sources` are the picture `<video>`s mounted (no screen
 * when the picture never draws it); `editorPlaying` is whether the editor
 * wants this Clip playing.
 */
export const useCompositePlayback = (o: {
  clock: RefObject<HTMLVideoElement | null>;
  segments: readonly SceneSegment[];
  offsetSeconds: number;
  sources: readonly PictureSource[];
  editorPlaying: boolean;
}) => {
  const camera = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLVideoElement>(null);
  const refs = { camera, screen };
  const each = (
    sources: readonly PictureSource[],
    act: (video: HTMLVideoElement) => void
  ) => {
    for (const source of sources) {
      const video = refs[source].current;
      if (video) act(video);
    }
  };
  /** Where each picture `<video>` is; an unmounted one counts as in place. */
  const sourceTimes = (clockTime: number) => {
    const picture = clockTime + o.offsetSeconds;
    return {
      camera: camera.current?.currentTime ?? picture,
      screen: screen.current?.currentTime ?? picture,
    };
  };

  const [state, dispatch] = useEffectReducer(
    compositePlaybackReducer,
    () =>
      createInitialCompositePlaybackState({
        segments: o.segments,
        offsetSeconds: o.offsetSeconds,
        sources: o.sources,
      }),
    {
      "seek-sources": (_state, effect) =>
        each(effect.sources, (video) => {
          video.currentTime = effect.at;
        }),
      "play-sources": (_state, effect) =>
        each(effect.sources, (video) => {
          video.playbackRate = effect.rate;
          void video.play().catch(() => {});
        }),
      "pause-sources": (_state, effect) =>
        each(effect.sources, (video) => video.pause()),
      "set-sources-rate": (_state, effect) =>
        each(effect.sources, (video) => {
          video.playbackRate = effect.rate;
        }),
      "hold-clock": (_state, effect, dispatch) => {
        o.clock.current?.pause();
        const cancelTimer = after(effect.expiresAfterMs, () =>
          dispatch({ type: "hold-expired", holdId: effect.holdId })
        );
        return cancelTimer;
      },
      "play-clock": () => {
        void o.clock.current?.play().catch(() => {});
      },
    }
  );

  // Bridge: a changed Clip Source (a Scene Override, a new mic offset).
  const sourceKey = JSON.stringify([o.segments, o.offsetSeconds, o.sources]);
  useEffect(() => {
    dispatch({
      type: "clip-source-changed",
      segments: o.segments,
      offsetSeconds: o.offsetSeconds,
      sources: o.sources,
    });
  }, [sourceKey]);

  // Bridge: whether the editor wants this Clip playing.
  useEffect(() => {
    dispatch({ type: o.editorPlaying ? "editor-played" : "editor-paused" });
  }, [o.editorPlaying]);

  // Bridge: what the clock does.
  useEffect(() => {
    const clock = o.clock.current;
    if (!clock) return;
    const at = () => ({
      clockTime: clock.currentTime,
      sourceTimes: sourceTimes(clock.currentTime),
    });
    const played = () =>
      dispatch({ type: "clock-played", rate: clock.playbackRate, ...at() });
    const paused = () => dispatch({ type: "clock-paused", ...at() });
    const seeked = () => dispatch({ type: "clock-seeked", ...at() });
    const rateChanged = () =>
      dispatch({ type: "clock-rate-changed", rate: clock.playbackRate });
    clock.addEventListener("play", played);
    clock.addEventListener("pause", paused);
    clock.addEventListener("seeked", seeked);
    clock.addEventListener("loadedmetadata", seeked);
    clock.addEventListener("ratechange", rateChanged);
    return () => {
      clock.removeEventListener("play", played);
      clock.removeEventListener("pause", paused);
      clock.removeEventListener("seeked", seeked);
      clock.removeEventListener("loadedmetadata", seeked);
      clock.removeEventListener("ratechange", rateChanged);
    };
  }, [o.clock.current, o.offsetSeconds]);

  // Bridge: the picture `<video>`s landing where they were sent.
  useEffect(() => {
    const cleanups = (["camera", "screen"] as const).map((source) => {
      const video = refs[source].current;
      if (!video) return () => {};
      const seeked = () => dispatch({ type: "source-seeked", source });
      video.addEventListener("seeked", seeked);
      return () => video.removeEventListener("seeked", seeked);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [camera.current, screen.current]);

  // Bridge: the clock's time, every frame while it plays.
  useEffect(() => {
    if (!state.playing) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const clock = o.clock.current;
      if (!clock) return;
      dispatch({
        type: "clock-ticked",
        clockTime: clock.currentTime,
        sourceTimes: sourceTimes(clock.currentTime),
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, o.offsetSeconds]);

  return { camera, screen, scene: compositeScene(state) };
};
