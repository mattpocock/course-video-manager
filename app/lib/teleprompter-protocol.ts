/**
 * Transport between the Video Editor and the teleprompter popup, cloned from
 * `diagram-protocol.ts` (BroadcastChannel, same-origin, no server). Deliberately
 * a SEPARATE channel name from "cvm-diagrams" so the two popups never parse each
 * other's traffic.
 *
 * Two differences from the diagram protocol, both because the teleprompter is a
 * pure slave to the editor:
 *
 *   - There is no "load this video" command and no picker. `editorState` carries
 *     the editor's current videoId, so the main window is unconditionally the
 *     source of truth for what's on the glass. No video open in the editor means
 *     an empty teleprompter.
 *   - `editorState` also carries capture state, mirroring the editor's recording
 *     + silence-detection indicator so the same status is visible on the glass,
 *     and the side panel's active tab, so the glass shows whichever of Script
 *     or Beats you're looking at in the editor.
 *
 * State is **pushed, not polled**. `editorState` goes out when it changes, so
 * the glass is never more than a message behind the editor. The ping/pong
 * heartbeat exists only to answer "is the editor still there" — a pong carries
 * nothing, and a popup that is already attached learns everything by push.
 * `hello` is the handshake for the other join order: a popup opened after the
 * editor mounted missed the mount push, so it asks once, and keeps asking only
 * while it believes nobody is on the other end.
 *
 * Nothing else flows back the other way: the teleprompter never reports position.
 */
import { z } from "zod";

/**
 * Mirrors `FrontendSpeechDetectorState["type"]` from
 * `app/features/video-editor/use-speech-detector.ts`, plus the not-recording
 * case (which the editor expresses via OBS state rather than the speech union).
 */
export const CaptureStatus = z.enum([
  "not-recording",
  "warming-up",
  "speaking-detected",
  "long-enough-speaking-for-clip-detected",
  "silence",
]);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

/**
 * Which tab the editor's side panel is showing. Declared here rather than
 * imported from `app/features/video-editor/beat-tab.ts` because this is a wire
 * format: `app/lib` doesn't reach into features, and a transport that owns its
 * own vocabulary can't be broken by a refactor on either side of the channel.
 */
export const EditorTab = z.enum(["beats", "reference", "script"]);
export type EditorTab = z.infer<typeof EditorTab>;

/**
 * PROTOTYPE — the state of one clip in the current recording session.
 *
 * Two independent axes, deliberately: whether the backend has caught up
 * (pending vs landed), and whether the clip is healthy (ok / orphaned /
 * deleted). The display draws them as fill and colour respectively, so neither
 * question can hide the other.
 *
 *   pending         — the frontend heard it; no database clip yet.
 *   landed          — paired with a database clip. The happy ending.
 *   orphaned        — the timeout expired. No database clip is coming: the
 *                     frontend heard speech the backend's silence detection
 *                     disagreed with. Only ever optimistic, by definition.
 *   deleted-pending — deleted by hand before the backend caught up.
 *   deleted-landed  — deleted by hand, already paired.
 */
export const ClipMarkState = z.enum([
  "pending",
  "landed",
  "orphaned",
  "deleted-pending",
  "deleted-landed",
]);
export type ClipMarkState = z.infer<typeof ClipMarkState>;

/**
 * Every clip in the current recording session, oldest first. An ordered list
 * rather than counts so a clip changing state repaints one mark in place
 * instead of regrouping the whole display.
 *
 * Optional so a popup left open across a reload of this branch doesn't fail to
 * parse the whole message and go blank.
 */
export const ClipMarks = z.array(ClipMarkState);
export type ClipMarks = z.infer<typeof ClipMarks>;

export const TeleprompterParentToChild = z.discriminatedUnion("type", [
  /**
   * What the editor has open, what capture is doing, and which tab it's showing.
   * Pushed whenever any of the three changes — plus once on editor mount, and
   * once in answer to a `hello`. Never sent on a timer.
   */
  z.object({
    type: z.literal("editorState"),
    videoId: z.string().nullable(),
    capture: CaptureStatus,
    tab: EditorTab,
    marks: ClipMarks.optional(),
  }),
  /** Heartbeat answer, and nothing more. State travels by `editorState`. */
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("editorDisconnected") }),
  /** Editor saved a script or edited beats; refetch now, don't wait for the poll. */
  z.object({ type: z.literal("contentChanged"), videoId: z.string() }),
  /**
   * The script as it stands in the editor *right now*, pushed on every
   * keystroke. Carries the text itself rather than telling the popup to
   * refetch: a refetch would race the save that produced it, and the round trip
   * is the difference between "instant" and "a beat later".
   */
  z.object({
    type: z.literal("scriptChanged"),
    videoId: z.string(),
    script: z.string(),
  }),
  /**
   * A transport control pressed in the *editor* window. The popup only receives
   * keystrokes when it has OS focus, which it won't while you're reading off the
   * Prompter, so the editor forwards its own presses.
   */
  z.object({
    type: z.literal("command"),
    command: z.enum(["advance", "back", "togglePlay", "reset"]),
  }),
]);

export const TeleprompterChildToParent = z.discriminatedUnion("type", [
  /** Liveness only. Answered with a bare `pong`. */
  z.object({ type: z.literal("ping") }),
  /** "I just arrived, or I think you left — send me your state once." */
  z.object({ type: z.literal("hello") }),
]);

export type TeleprompterParentToChildMessage = z.infer<
  typeof TeleprompterParentToChild
>;
export type TeleprompterCommand = Extract<
  TeleprompterParentToChildMessage,
  { type: "command" }
>["command"];
export type TeleprompterChildToParentMessage = z.infer<
  typeof TeleprompterChildToParent
>;

const CHANNEL_NAME = "cvm-teleprompter";

let sendChannel: BroadcastChannel | null = null;
function getSendChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!sendChannel) sendChannel = new BroadcastChannel(CHANNEL_NAME);
  return sendChannel;
}

export function sendToTeleprompter(
  message: TeleprompterParentToChildMessage
): void {
  getSendChannel()?.postMessage(message);
}

export function sendToEditor(message: TeleprompterChildToParentMessage): void {
  getSendChannel()?.postMessage(message);
}

/** Subscribe from the editor side — only sees child→parent messages. */
export function subscribeTeleprompterParent(
  handler: (message: TeleprompterChildToParentMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e) => {
    const result = TeleprompterChildToParent.safeParse(e.data);
    if (result.success) handler(result.data);
  };
  return () => ch.close();
}

/** Subscribe from the popup side — only sees parent→child messages. */
export function subscribeTeleprompterChild(
  handler: (message: TeleprompterParentToChildMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e) => {
    const result = TeleprompterParentToChild.safeParse(e.data);
    if (result.success) handler(result.data);
  };
  return () => ch.close();
}
