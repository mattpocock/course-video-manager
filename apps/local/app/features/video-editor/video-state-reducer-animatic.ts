import type { EffectReducer } from "use-effect-reducer";
import type { videoStateReducer } from "./video-state-reducer";

/**
 * The Animatic player open OVER the Video Editor, and the Clip Mockup it was
 * opened on — or `null`.
 *
 * WHILE IT IS SET, THE ANIMATIC OWNS THE KEYBOARD. Both surfaces listen on
 * the window, so one of them has to stand down: the editor's reducer drops
 * every editor shortcut event (`EDITOR_SHORTCUT_ACTIONS`), and the player's
 * own keys (`use-animatic-shortcuts.ts`) are the only ones that act. Nothing
 * fires twice, and no handler has to stop a key from reaching another one.
 * ESC, the player's key, dismisses it and gives the keys back.
 */
export type AnimaticOwner = { clipMockupId: string } | null;

export type AnimaticAction =
  | {
      /** A Clip Mockup was clicked in the side panel's Animatic tab. */
      type: "click-animatic-clip-mockup";
      clipMockupId: string;
      /** Whether a Take is being recorded that the editor can stop. */
      takeRecording: boolean;
    }
  | {
      /** The author closed the Animatic player (ESC or its close button). */
      type: "dismiss-animatic";
    };

/**
 * Stop the Take being recorded by the editor's one Stop path (the CVM
 * recorder's `press-stop`, which POSTs `/recorder/stop`), so its Clip is
 * finalised as any other Stop finalises it.
 */
export type AnimaticEffect = { type: "stop-recording" };

/**
 * The events `useKeyboardShortcuts` dispatches — what the open Animatic
 * player takes over. Pointer gestures are not in it: the overlay covers
 * everything they could be pressed on.
 */
const EDITOR_SHORTCUT_ACTIONS: ReadonlySet<string> = new Set<
  videoStateReducer.Action["type"]
>([
  "press-space-bar",
  "press-delete",
  "press-return",
  "press-arrow-left",
  "press-arrow-right",
  "press-arrow-up",
  "press-arrow-down",
  "press-alt-arrow-up",
  "press-alt-arrow-down",
  "press-l",
  "press-k",
  "press-home",
  "press-end",
  "pause-toggle-key-pressed",
]);

/** Whether the open Animatic owns the key this event came from. */
export const isKeyOwnedByAnimatic = (
  state: videoStateReducer.State,
  action: videoStateReducer.Action
) => state.animatic !== null && EDITOR_SHORTCUT_ACTIONS.has(action.type);

/**
 * Whether a layout with no replay drops this event: every editor key, and a
 * teleprompter mark, which would play its Clip in place of the live picture.
 */
export const isDroppedWithoutReplay = (
  state: videoStateReducer.State,
  action: videoStateReducer.Action
) =>
  !state.replay &&
  (EDITOR_SHORTCUT_ACTIONS.has(action.type) ||
    action.type === "click-teleprompter-mark");

/**
 * Opening the player stops what would play or record under it: the editor's
 * playback pauses, and a recording Take is stopped.
 */
export const reduceAnimatic = (
  state: videoStateReducer.State,
  action: AnimaticAction,
  exec: Parameters<
    EffectReducer<
      videoStateReducer.State,
      videoStateReducer.Action,
      videoStateReducer.Effect
    >
  >[2]
): videoStateReducer.State => {
  switch (action.type) {
    case "click-animatic-clip-mockup":
      if (action.takeRecording) exec({ type: "stop-recording" });
      return {
        ...state,
        runningState: "paused",
        animatic: { clipMockupId: action.clipMockupId },
      };
    case "dismiss-animatic":
      return { ...state, animatic: null };
  }
};
