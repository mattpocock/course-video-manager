import { useEffect, useRef, type RefObject } from "react";
import { useEffectReducer } from "use-effect-reducer";
import type { SceneSegment } from "@/packages/scene-layout";
import {
  compositePlaybackReducer,
  compositeScene,
  createInitialCompositePlaybackState,
  type PictureSource,
} from "./composite-playback-reducer";

const PICTURE_SOURCES: readonly PictureSource[] = ["camera", "screen"];

/**
 * The effect runner for `compositePlaybackReducer`, and the bridge from the
 * clock `<video>` (a new-recorder Clip's mic) and the two picture `<video>`s
 * into it. Returns the refs the picture `<video>`s mount on and the scene to
 * draw now.
 */
export const useCompositePlayback = (o: {
  clock: RefObject<HTMLVideoElement | null>;
  segments: readonly SceneSegment[];
  offsetSeconds: number;
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

  const [state, dispatch] = useEffectReducer(
    compositePlaybackReducer,
    () =>
      createInitialCompositePlaybackState({
        segments: o.segments,
        offsetSeconds: o.offsetSeconds,
      }),
    {
      "play-sources": (_state, effect) =>
        each(PICTURE_SOURCES, (video) => {
          video.currentTime = effect.at;
          video.playbackRate = effect.rate;
          void video.play().catch(() => {});
        }),
      "pause-sources": (_state, effect) =>
        each(PICTURE_SOURCES, (video) => {
          video.pause();
          video.currentTime = effect.at;
        }),
      "seek-sources": (_state, effect) =>
        each(effect.sources, (video) => {
          video.currentTime = effect.at;
        }),
      "set-sources-rate": (_state, effect) =>
        each(PICTURE_SOURCES, (video) => {
          video.playbackRate = effect.rate;
        }),
    }
  );

  // Bridge: a changed Clip Source (a Scene Override, a new mic offset).
  const sourceKey = JSON.stringify([o.segments, o.offsetSeconds]);
  useEffect(() => {
    dispatch({
      type: "clip-source-changed",
      segments: o.segments,
      offsetSeconds: o.offsetSeconds,
    });
  }, [sourceKey]);

  // Bridge: what the clock does.
  useEffect(() => {
    const clock = o.clock.current;
    if (!clock) return;
    const played = () =>
      dispatch({
        type: "clock-played",
        clockTime: clock.currentTime,
        rate: clock.playbackRate,
      });
    const paused = () =>
      dispatch({ type: "clock-paused", clockTime: clock.currentTime });
    const seeked = () =>
      dispatch({ type: "clock-seeked", clockTime: clock.currentTime });
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
  }, [o.clock.current]);

  // Bridge: the picture `<video>`s landing where they were sent.
  useEffect(() => {
    const cleanups = PICTURE_SOURCES.map((source) => {
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
      const picture = clock.currentTime + o.offsetSeconds;
      dispatch({
        type: "clock-ticked",
        clockTime: clock.currentTime,
        sourceTimes: {
          camera: camera.current?.currentTime ?? picture,
          screen: screen.current?.currentTime ?? picture,
        },
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, o.offsetSeconds]);

  return { camera, screen, scene: compositeScene(state) };
};
