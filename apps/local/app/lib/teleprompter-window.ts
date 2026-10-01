/**
 * Main-app side of the teleprompter popup. The window, the channel and liveness
 * live in `teleprompterChannel` (see `popup-channel.ts`).
 *
 * The editor calls `enableTeleprompterEditorMode()` to answer the popup's
 * heartbeat and handshake, and {@link pushTeleprompterState} whenever what it
 * has open changes. Because the popup has no picker, those pushes are the *only*
 * way it learns what to show.
 *
 * The wire format and the reasoning behind the push-not-poll design live in
 * `teleprompter-protocol.ts`, which is the de facto ADR for this pair.
 */
import {
  teleprompterChannel,
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
  const unsub = teleprompterChannel.subscribeParent(
    (msg: TeleprompterChildToParentMessage) => {
      if (msg.type === "ping")
        teleprompterChannel.sendToChild({ type: "pong" });
      else if (msg.type === "hello") pushTeleprompterState(getState());
    }
  );
  return () => {
    teleprompterChannel.sendToChild({ type: "editorDisconnected" });
    unsub();
  };
}

/**
 * Push what the editor has open onto the glass. Call on change, not on a timer:
 * the popup holds the last value it was given, so a message only needs to go out
 * when that value stops being true.
 */
export function pushTeleprompterState(state: TeleprompterEditorState): void {
  teleprompterChannel.sendToChild({ type: "editorState", ...state });
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
  teleprompterChannel.sendToChild({ type: "scriptChanged", videoId, script });
}

/** Forward a transport control pressed in the editor to the popup. */
export function sendTeleprompterCommand(command: TeleprompterCommand): void {
  teleprompterChannel.sendToChild({ type: "command", command });
}
