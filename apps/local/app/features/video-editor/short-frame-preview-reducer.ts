import type { EffectReducer } from "use-effect-reducer";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import type { RunningState } from "./video-state-reducer";
import {
  EXPORT_FPS,
  exportFrameAt,
  exportFrameCount,
} from "@/packages/clip-source";

/**
 * THE PORTRAIT STUDIO'S PREVIEW (#2580). Paused or scrubbing, a Short shows
 * the frame its post will show: drawn by the export's own code, the same as
 * `cvm clip frame` (`clip-frame.ts`, through
 * `/clips/:clipId/frame`). Playing, it shows the editor's playback,
 * which draws the Footage Layers itself (`footage-layers-preview.tsx`).
 *
 * A frame takes the server seconds (an ffmpeg decode and one Remotion
 * frame), so one is drawn at a time: while it draws, only the latest frame
 * asked for waits, and the ones scrubbed past are never asked for. A frame
 * is a still, so it is refused while anything records (the Still Gate, a
 * 503); the preview says so, and asks again after the Stop, which makes a
 * new request (its `round`).
 */

/** The export's frame rate: a frame is asked for on its grid. */
const FPS = EXPORT_FPS;

/** One composed frame of a Short's Clip: `at` seconds into the Clip. */
export type ShortFrameRequest = {
  readonly clipId: string;
  readonly at: number;
  /** The route's query: the time, and what the frame is drawn from. */
  readonly search: string;
  /** The route; also what the request is known by. */
  readonly url: string;
};

/** A saved Clip as the request reads it. */
export type ShortFrameClip = {
  readonly databaseId: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly text: string;
  readonly sceneOverride?: string | null;
  readonly layers?: readonly ClipLayerRow[];
};

/** A short, stable digest of what the frame is drawn from (FNV-1a). */
const digest = (value: unknown): string => {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

/**
 * The frame the preview should show, or null for none (playing, or no saved
 * Clip). Its time is the scrub's, else where playback stopped, on the
 * render's 60 fps grid and inside the Clip. Its URL names what the frame is
 * drawn from (the Clip's span, words and Layers) and the Stop it was asked
 * after, so a change to any is asked for afresh and nothing else is.
 */
export const shortFrameRequest = (input: {
  clip: ShortFrameClip | undefined;
  runningState: RunningState;
  /** Seconds into the source, as the scrub slider gives them. */
  scrubSeekTime: number | undefined;
  currentTimeInClip: number;
  /** Which Stop the stills were last asked for after (`stillRound`). */
  round: string;
}): ShortFrameRequest | null => {
  const { clip } = input;
  if (!clip || input.runningState === "playing") return null;
  const time =
    input.scrubSeekTime !== undefined
      ? input.scrubSeekTime - clip.sourceStartTime
      : input.currentTimeInClip;
  const lastFrame =
    exportFrameCount(clip.sourceEndTime - clip.sourceStartTime) - 1;
  const frame = Math.min(
    Math.max(0, exportFrameAt(time)),
    Math.max(0, lastFrame)
  );
  const at = frame / FPS;
  const version = digest([
    clip.sourceStartTime,
    clip.sourceEndTime,
    clip.text,
    clip.sceneOverride ?? null,
    clip.layers ?? [],
    input.round,
  ]);
  const search = `at=${at}&v=${version}`;
  return {
    clipId: clip.databaseId,
    at,
    search,
    url: `/clips/${clip.databaseId}/frame?${search}`,
  };
};

export namespace shortFramePreviewReducer {
  export type State = {
    /** The frame the preview should show now. */
    wanted: ShortFrameRequest | null;
    /** The URL being drawn: one at a time. */
    drawing: string | null;
    /** The last frame drawn, kept for as long as nothing newer is. */
    drawn: { url: string; image: string } | null;
    /** A frame refused while recording. */
    held: string | null;
    failed: { url: string; message: string } | null;
  };

  export type Action =
    /** What the editor's playhead now asks for (null: nothing, it plays). */
    | { type: "frame-wanted"; request: ShortFrameRequest | null }
    | { type: "frame-drawn"; url: string; image: string }
    /** The Still Gate refused it: something records. */
    | { type: "frame-held"; url: string }
    | { type: "frame-failed"; url: string; message: string };

  export type Effect =
    | { type: "draw-frame"; request: ShortFrameRequest }
    /** An object URL no longer shown. */
    | { type: "release-frame-image"; image: string };
}

type State = shortFramePreviewReducer.State;

export const createInitialShortFramePreviewState = (): State => ({
  wanted: null,
  drawing: null,
  drawn: null,
  held: null,
  failed: null,
});

const settled = (state: State, url: string) =>
  state.drawn?.url === url || state.held === url || state.failed?.url === url;

export const shortFramePreviewReducer: EffectReducer<
  State,
  shortFramePreviewReducer.Action,
  shortFramePreviewReducer.Effect
> = (state, action, exec) => {
  /** Draws the frame wanted, if it is not drawn or drawing already. */
  const drawWanted = (next: State): State => {
    const request = next.wanted;
    if (!request || next.drawing !== null || settled(next, request.url)) {
      return next;
    }
    exec({ type: "draw-frame", request });
    return { ...next, drawing: request.url };
  };

  switch (action.type) {
    case "frame-wanted":
      return drawWanted({ ...state, wanted: action.request });
    case "frame-drawn": {
      if (action.url !== state.drawing) {
        exec({ type: "release-frame-image", image: action.image });
        return state;
      }
      if (state.drawn) {
        exec({ type: "release-frame-image", image: state.drawn.image });
      }
      return drawWanted({
        ...state,
        drawing: null,
        drawn: { url: action.url, image: action.image },
      });
    }
    case "frame-held":
      if (action.url !== state.drawing) return state;
      return drawWanted({ ...state, drawing: null, held: action.url });
    case "frame-failed":
      if (action.url !== state.drawing) return state;
      return drawWanted({
        ...state,
        drawing: null,
        failed: { url: action.url, message: action.message },
      });
  }
};

export type ShortFramePreview = {
  /** The composed frame to show over the player, or null for the player. */
  image: string | null;
  status: "idle" | "drawing" | "shown" | "held" | "failed";
  message: string | null;
};

export const HELD_MESSAGE =
  "No preview while recording: it asks again after the Stop";

/** What the preview shows for the frame wanted now. */
export const shortFramePreview = (state: State): ShortFramePreview => {
  const url = state.wanted?.url;
  if (!url) return { image: null, status: "idle", message: null };
  if (state.drawn?.url === url) {
    return { image: state.drawn.image, status: "shown", message: null };
  }
  if (state.held === url) {
    return { image: null, status: "held", message: HELD_MESSAGE };
  }
  if (state.failed?.url === url) {
    return { image: null, status: "failed", message: state.failed.message };
  }
  return { image: null, status: "drawing", message: null };
};
