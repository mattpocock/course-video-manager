/**
 * PROTOTYPE — throwaway. Parent-side API for the teleprompter popup, cloned
 * from `diagram-window.ts`.
 *
 * The editor calls `enableTeleprompterEditorMode(videoId, capture)`; that single
 * call answers pings, hands over the current videoId, and relays capture state.
 * Because the popup has no picker, this is the *only* way it learns what to show.
 */
import {
  sendToTeleprompter,
  subscribeTeleprompterParent,
  type CaptureStatus,
  type EditorTab,
  type TeleprompterCommand,
  type TeleprompterChildToParentMessage,
} from "./teleprompter-protocol";

const TELEPROMPTER_PATH = "/teleprompter";
const WINDOW_NAME = "cvm-teleprompter";
// Sized to the Elgato Prompter's panel (9", 1024x600) so what you judge in the
// popup is what you'll get on the glass.
const POPUP_FEATURES = "popup,width=1024,height=600";
const ALIVE_WINDOW_MS = 5000;

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
 * Called by the Video Editor. `getState` is read at pong time rather than
 * captured, so a fast-changing capture status doesn't require re-subscribing
 * (and therefore doesn't churn the channel while recording).
 */
export function enableTeleprompterEditorMode(
  getState: () => {
    videoId: string | null;
    capture: CaptureStatus;
    tab: EditorTab;
  }
): () => void {
  if (typeof window === "undefined") return () => {};
  const unsub = subscribeTeleprompterParent(
    (msg: TeleprompterChildToParentMessage) => {
      if (msg.type === "ping") {
        const { videoId, capture, tab } = getState();
        sendToTeleprompter({ type: "pong", videoId, capture, tab });
      }
    }
  );
  const initial = getState();
  sendToTeleprompter({
    type: "editorConnected",
    videoId: initial.videoId,
    capture: initial.capture,
    tab: initial.tab,
  });
  return () => {
    sendToTeleprompter({ type: "editorDisconnected" });
    unsub();
  };
}

/** Nudge an open teleprompter to refetch immediately after an edit. */
export function notifyTeleprompterContentChanged(videoId: string): void {
  sendToTeleprompter({ type: "contentChanged", videoId });
}

/**
 * Mirror the script being typed onto the glass, throttled to
 * {@link SCRIPT_PUSH_MS}.
 *
 * Leading *and* trailing: the first keystroke lands immediately so the update
 * feels instant, and the last one always lands too, so the glass can't end up
 * one keystroke behind when you stop typing.
 */
const SCRIPT_PUSH_MS = 250;
let lastScriptPushAt = 0;
let pendingScriptPush: ReturnType<typeof setTimeout> | null = null;

export function pushTeleprompterScript(videoId: string, script: string): void {
  if (typeof window === "undefined") return;
  if (pendingScriptPush) clearTimeout(pendingScriptPush);

  const send = () => {
    lastScriptPushAt = Date.now();
    pendingScriptPush = null;
    sendToTeleprompter({ type: "scriptChanged", videoId, script });
  };

  const since = Date.now() - lastScriptPushAt;
  if (since >= SCRIPT_PUSH_MS) send();
  else pendingScriptPush = setTimeout(send, SCRIPT_PUSH_MS - since);
}

/** Forward a transport control pressed in the editor to the popup. */
export function sendTeleprompterCommand(command: TeleprompterCommand): void {
  sendToTeleprompter({ type: "command", command });
}

function isTeleprompterAlive(): boolean {
  if (popupRef && popupRef.closed) {
    popupRef = null;
    lastPingAt = 0;
    return false;
  }
  return Date.now() - lastPingAt < ALIVE_WINDOW_MS;
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
