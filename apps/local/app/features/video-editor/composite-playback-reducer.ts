import type { EffectReducer } from "use-effect-reducer";
import { sceneAt } from "@/packages/clip-source";
import type { Scene, SceneSegment } from "@/packages/scene-layout";

/**
 * Editor playback of a new-recorder Clip: its mic plays as the clock (the
 * `<video>` every Clip already has), and its camera and screen files play
 * along, muted, in the picture's clock — the mic offset after the mic — to be
 * drawn on a canvas in the scene of the moment.
 *
 * Events are what the clock and the two picture `<video>`s report; effects
 * are what the runner does to the picture `<video>`s.
 */
export type PictureSource = "camera" | "screen";

const PICTURE_SOURCES: readonly PictureSource[] = ["camera", "screen"];

/** How far a picture `<video>` may wander from the mic before it is reseeked. */
export const MAX_PICTURE_DRIFT_SECONDS = 0.1;

export namespace compositePlaybackReducer {
  export interface State {
    readonly segments: readonly SceneSegment[];
    /** Picture time = clock time + this (the Recording Session's mic offset). */
    readonly offsetSeconds: number;
    /** Where the clock says the picture is, in the picture's clock. */
    readonly pictureTime: number;
    readonly playing: boolean;
    /** Picture `<video>`s told to seek that have not reported `seeked` yet. */
    readonly seeking: readonly PictureSource[];
  }

  export type Action =
    | { type: "clock-played"; clockTime: number; rate: number }
    | { type: "clock-paused"; clockTime: number }
    | { type: "clock-seeked"; clockTime: number }
    | {
        type: "clock-ticked";
        clockTime: number;
        sourceTimes: Readonly<Record<PictureSource, number>>;
      }
    | { type: "clock-rate-changed"; rate: number }
    | { type: "source-seeked"; source: PictureSource }
    /** The Clip's picture was redrawn (a Scene Override, a new mic offset). */
    | {
        type: "clip-source-changed";
        segments: readonly SceneSegment[];
        offsetSeconds: number;
      };

  export type Effect =
    | { type: "play-sources"; at: number; rate: number }
    | { type: "pause-sources"; at: number }
    | { type: "seek-sources"; at: number; sources: PictureSource[] }
    | { type: "set-sources-rate"; rate: number };
}

export const createInitialCompositePlaybackState = (o: {
  segments: readonly SceneSegment[];
  offsetSeconds: number;
}): compositePlaybackReducer.State => ({
  segments: o.segments,
  offsetSeconds: o.offsetSeconds,
  pictureTime: o.segments[0]?.startSeconds ?? 0,
  playing: false,
  seeking: [],
});

/** Rounds away float noise from adding the offset (10.149999). */
const tidy = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/** The scene the canvas draws now. */
export const compositeScene = (state: compositePlaybackReducer.State): Scene =>
  sceneAt(state.segments, state.pictureTime);

export const compositePlaybackReducer: EffectReducer<
  compositePlaybackReducer.State,
  compositePlaybackReducer.Action,
  compositePlaybackReducer.Effect
> = (state, action, exec) => {
  const picture = (clockTime: number) => tidy(clockTime + state.offsetSeconds);
  switch (action.type) {
    case "clock-played": {
      const at = picture(action.clockTime);
      exec({ type: "play-sources", at, rate: action.rate });
      return { ...state, pictureTime: at, playing: true };
    }
    case "clock-paused": {
      const at = picture(action.clockTime);
      exec({ type: "pause-sources", at });
      return { ...state, pictureTime: at, playing: false };
    }
    case "clock-seeked": {
      const at = picture(action.clockTime);
      exec({ type: "seek-sources", at, sources: [...PICTURE_SOURCES] });
      return { ...state, pictureTime: at, seeking: [...PICTURE_SOURCES] };
    }
    case "clock-ticked": {
      const at = picture(action.clockTime);
      if (!state.playing) return { ...state, pictureTime: at };
      const drifted = PICTURE_SOURCES.filter(
        (s) =>
          !state.seeking.includes(s) &&
          Math.abs(action.sourceTimes[s] - at) > MAX_PICTURE_DRIFT_SECONDS
      );
      if (drifted.length > 0) {
        exec({ type: "seek-sources", at, sources: drifted });
      }
      return {
        ...state,
        pictureTime: at,
        seeking: [...state.seeking, ...drifted],
      };
    }
    case "clock-rate-changed":
      exec({ type: "set-sources-rate", rate: action.rate });
      return state;
    case "clip-source-changed":
      return {
        ...state,
        segments: action.segments,
        offsetSeconds: action.offsetSeconds,
      };
    case "source-seeked":
      return {
        ...state,
        seeking: state.seeking.filter((s) => s !== action.source),
      };
  }
};
