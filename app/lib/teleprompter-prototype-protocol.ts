/**
 * PROTOTYPE — throwaway. See app/features/teleprompter-prototype/README.md.
 *
 * Transport between the Video Editor and the teleprompter popup, cloned from
 * `diagram-protocol.ts` (BroadcastChannel, same-origin, no server). Deliberately
 * a SEPARATE channel name from "cvm-diagrams" so the two popups never parse each
 * other's traffic.
 *
 * Two differences from the diagram protocol, both because the teleprompter is a
 * pure slave to the editor:
 *
 *   - There is no "load this video" command and no picker. `pong` carries the
 *     editor's current videoId, so the main window is unconditionally the source
 *     of truth for what's on the glass. No video open in the editor means an
 *     empty teleprompter.
 *   - `pong` also carries capture state, mirroring the editor's recording +
 *     silence-detection indicator so the same status is visible on the glass.
 *
 * Nothing flows back the other way: the teleprompter never reports position.
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

export const TeleprompterParentToChild = z.discriminatedUnion("type", [
  /** Editor answering a ping: what it has open, and what capture is doing. */
  z.object({
    type: z.literal("pong"),
    videoId: z.string().nullable(),
    capture: CaptureStatus,
  }),
  /** Sent on editor mount so the popup catches up without waiting a beat. */
  z.object({
    type: z.literal("editorConnected"),
    videoId: z.string().nullable(),
    capture: CaptureStatus,
  }),
  z.object({ type: z.literal("editorDisconnected") }),
  /** Editor saved a script or edited beats; refetch now, don't wait for the poll. */
  z.object({ type: z.literal("contentChanged"), videoId: z.string() }),
]);

export const TeleprompterChildToParent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
]);

export type TeleprompterParentToChildMessage = z.infer<
  typeof TeleprompterParentToChild
>;
export type TeleprompterChildToParentMessage = z.infer<
  typeof TeleprompterChildToParent
>;

const CHANNEL_NAME = "cvm-teleprompter-prototype";

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
