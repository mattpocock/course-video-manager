/**
 * PROTOTYPE — throwaway. Parent-side API for the teleprompter popup, cloned
 * from `diagram-window.ts`.
 *
 * The editor calls `enableTeleprompterEditorMode()` to answer the popup's
 * heartbeat and handshake, and {@link pushTeleprompterState} whenever what it
 * has open changes. Because the popup has no picker, those pushes are the *only*
 * way it learns what to show.
 */
import {
  sendToTeleprompter,
  subscribeTeleprompterParent,
  type CaptureStatus,
  type EditorTab,
  type ClipMarks,
  type TeleprompterCommand,
  type TeleprompterChildToParentMessage,
} from "./teleprompter-protocol";

export type TeleprompterEditorState = {
  videoId: string | null;
  capture: CaptureStatus;
  tab: EditorTab;
  /** This session's clips, for the marks display on the glass. */
  marks?: ClipMarks;
};

const TELEPROMPTER_PATH = "/teleprompter";
const WINDOW_NAME = "cvm-teleprompter";
// Sized to the Elgato Prompter's panel (9", 1024x600) so what you judge in the
// popup is what you'll get on the glass.
const POPUP_FEATURES = "popup,width=1024,height=600";
/**
 * How long after a ping the popup is presumed still there — the editor-side
 * mirror of `EDITOR_ALIVE_MS`. The popup pings every 2s, so this survives one
 * missed beat.
 */
export const TELEPROMPTER_ALIVE_WINDOW_MS = 5000;

let lastPingAt = 0;
let livenessSubscribed = false;
let popupRef: Window | null = null;

/**
 * Runs in every tab that imports this module so a launcher knows whether the
 * popup is already open. Does not pong — only a mounted editor does that.
 */
function ensureLivenessTracker(): void {
  if (livenessSubscribed) return;
  if (typeof window === "undefined") return;
  livenessSubscribed = true;
  subscribeTeleprompterParent((msg: TeleprompterChildToParentMessage) => {
    if (msg.type === "ping") lastPingAt = Date.now();
  });
}

/**
 * Called by the Video Editor. Answers the popup's heartbeat with a bare pong,
 * and its handshake with the current state.
 *
 * `getState` is read at message time rather than captured so a fast-changing
 * capture status doesn't require re-subscribing (and therefore doesn't churn
 * the channel while recording). It is *not* how the popup normally learns
 * anything — that's {@link pushTeleprompterState}. A `hello` only arrives when
 * the popup thinks nobody is attached, so this reply is the join handshake, not
 * a poll.
 */
export function enableTeleprompterEditorMode(
  getState: () => TeleprompterEditorState
): () => void {
  if (typeof window === "undefined") return () => {};
  const unsub = subscribeTeleprompterParent(
    (msg: TeleprompterChildToParentMessage) => {
      if (msg.type === "ping") sendToTeleprompter({ type: "pong" });
      else if (msg.type === "hello") pushTeleprompterState(getState());
    }
  );
  return () => {
    sendToTeleprompter({ type: "editorDisconnected" });
    unsub();
  };
}

/**
 * Push what the editor has open onto the glass. Call on change, not on a timer:
 * the popup holds the last value it was given, so a message only needs to go out
 * when that value stops being true.
 */
export function pushTeleprompterState(state: TeleprompterEditorState): void {
  sendToTeleprompter({ type: "editorState", ...state });
}

/** Nudge an open teleprompter to refetch immediately after an edit. */
export function notifyTeleprompterContentChanged(videoId: string): void {
  sendToTeleprompter({ type: "contentChanged", videoId });
}

/**
 * Mirror the script being typed onto the glass, on every keystroke.
 *
 * Deliberately unthrottled: this is a same-origin structured clone handed to
 * another window in-process, so a few KB per keypress costs nothing, and rate
 * limiting it only buys a glass that lags the editor. (The save this rides
 * alongside is the expensive half, and that one is worth batching.)
 */
export function pushTeleprompterScript(videoId: string, script: string): void {
  sendToTeleprompter({ type: "scriptChanged", videoId, script });
}

/** Forward a transport control pressed in the editor to the popup. */
export function sendTeleprompterCommand(command: TeleprompterCommand): void {
  sendToTeleprompter({ type: "command", command });
}

/**
 * Whether a ping heard at `lastPingAt` still means the popup is there. Pure and
 * clock-injected so the window is testable; `0` means nothing has ever pinged.
 */
export function isPingFresh(pingAt: number, now: number): boolean {
  return pingAt > 0 && now - pingAt < TELEPROMPTER_ALIVE_WINDOW_MS;
}

/**
 * Is a teleprompter popup attached right now?
 *
 * Polled rather than subscribed: liveness expires by the clock, so there is no
 * message to hang an event on when it goes away.
 */
export function isTeleprompterAlive(): boolean {
  if (popupRef && popupRef.closed) {
    popupRef = null;
    lastPingAt = 0;
    return false;
  }
  return isPingFresh(lastPingAt, Date.now());
}

/**
 * No videoId argument by design: the popup always shows whatever the editor
 * currently has open, so there is nothing to pass.
 */
export function openTeleprompter(): void {
  if (isTeleprompterAlive() && popupRef) {
    popupRef.focus();
    return;
  }
  const w = window.open(TELEPROMPTER_PATH, WINDOW_NAME, POPUP_FEATURES);
  if (w) popupRef = w;
  w?.focus();
}

ensureLivenessTracker();
