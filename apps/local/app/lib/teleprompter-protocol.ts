/**
 * Transport between the Video Editor and the teleprompter popup, built on
 * `popup-channel.ts` like `diagram-protocol.ts` (BroadcastChannel, same-origin,
 * no server). Deliberately a SEPARATE channel name from "cvm-diagrams" so the
 * two popups never parse each other's traffic.
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
 *     and one mark per clip in the current recording session, so the glass can show clips landing, and the
 *     newest clip's transcript, so a take can be read back, and the Video's
 *     length so far, so the scope of the video is visible from the glass.
 *
 * State is **pushed, not polled**. `editorState` goes out when it changes, so
 * the glass is never more than a message behind the editor. The ping/pong
 * heartbeat exists only to answer "is the editor still there" — a pong carries
 * nothing, and a popup that is already attached learns everything by push.
 * `hello` is the handshake for the other join order: a popup opened after the
 * editor mounted missed the mount push, so it asks once, and keeps asking only
 * while it believes nobody is on the other end.
 *
 * One thing flows back the other way: a dot clicked on the glass
 * (`clipMarkClicked`). It is a fact, not a command: the editor decides whether
 * that plays or pauses the Clip, and the glass learns the outcome the same way
 * it learns everything else, from the next `editorState` (`playingClipId`).
 * The teleprompter never reports reading position.
 */
import { z } from "zod";
import { createPopupChannel } from "./popup-channel";

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
 * The state of one clip in the current recording session.
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
 * Optional on the wire: a popup left open across a deploy would otherwise fail
 * to parse the whole message and go blank rather than merely lose the marks.
 * Absent is read as "no session".
 */
export const ClipMarks = z.array(ClipMarkState);
export type ClipMarks = z.infer<typeof ClipMarks>;

/**
 * The Clip each mark stands for, in the same order as `marks`, so a dot on the
 * glass can name its Clip. A sibling of `marks` rather than a field on each
 * mark, because changing the shape of `marks` would make a popup left open
 * across a deploy fail to parse every `editorState` and go blank.
 */
export const ClipMarkIds = z.array(z.string());
export type ClipMarkIds = z.infer<typeof ClipMarkIds>;

export const TeleprompterParentToChild = z.discriminatedUnion("type", [
  /**
   * What the editor has open, and what capture is doing. Pushed whenever any
   * of it changes — plus once on editor mount, and once in answer to a
   * `hello`. Never sent on a timer.
   */
  z.object({
    type: z.literal("editorState"),
    videoId: z.string().nullable(),
    capture: CaptureStatus,
    marks: ClipMarks.optional(),
    /** See `ClipMarkIds`. Optional for the same stale-popup reason as `marks`. */
    markClipIds: ClipMarkIds.optional(),
    /**
     * The Clip the editor's player is playing right now, or `null` when it is
     * paused. Optional for the same stale-popup reason as `marks`.
     */
    playingClipId: z.string().nullable().optional(),
    /**
     * The transcript of the newest transcribed clip in the current recording
     * session, deleted ones included, so a fluffed take can be read back on
     * the glass. Optional for the same stale-popup reason as `marks`.
     */
    latestTranscript: z.string().nullable().optional(),
    /**
     * How long the Video runs so far, in seconds: the same sum of live Clip
     * durations the editor shows under its player, so the glass can show the
     * scope of what's been filmed. Optional for the same stale-popup reason as
     * `marks`.
     */
    videoLengthSeconds: z.number().nonnegative().nullable().optional(),
    /**
     * The editor's Suggestions tab is open: the glass shows this line in place
     * of the Script, as it streams (empty until the first words arrive).
     * `null` when the tab is closed. Optional for the same stale-popup reason
     * as `marks`.
     */
    suggestion: z.string().nullable().optional(),
    /**
     * Which suggestion `suggestion` is: a new id means a new one has started,
     * so the glass centres it. Optional for the same stale-popup reason as
     * `marks`.
     */
    suggestionId: z.number().nullable().optional(),
    /**
     * The transcripts of the Clips just before the suggestion, oldest first,
     * shown dimmed above it as context. Optional for the same stale-popup
     * reason as `marks`.
     */
    suggestionPreviousClips: z.array(z.string()).optional(),
  }),
  /** Heartbeat answer, and nothing more. State travels by `editorState`. */
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("editorDisconnected") }),
  /** Editor saved a script; refetch now, don't wait for the poll. */
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
]);

export const TeleprompterChildToParent = z.discriminatedUnion("type", [
  /** Liveness only. Answered with a bare `pong`. */
  z.object({ type: z.literal("ping") }),
  /** "I just arrived, or I think you left — send me your state once." */
  z.object({ type: z.literal("hello") }),
  /**
   * A dot was clicked on the glass. The editor plays that Clip, or pauses it if
   * it is the one already playing.
   */
  z.object({ type: z.literal("clipMarkClicked"), clipId: z.string() }),
]);

export type TeleprompterParentToChildMessage = z.infer<
  typeof TeleprompterParentToChild
>;
export type TeleprompterChildToParentMessage = z.infer<
  typeof TeleprompterChildToParent
>;

export const teleprompterChannel = createPopupChannel({
  name: "cvm-teleprompter",
  url: "/teleprompter",
  // Sized to the Elgato Prompter's panel (9", 1024x600) so what you judge in
  // the popup is what you'll get on the glass.
  windowFeatures: "popup,width=1024,height=600",
  toChild: TeleprompterParentToChild,
  toParent: TeleprompterChildToParent,
});
