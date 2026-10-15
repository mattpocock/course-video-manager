/**
 * Keep the teleprompter popup in step with this editor.
 *
 * The popup has no picker, so this is the only way it learns which video to
 * show, what capture is doing, what this recording session's clips are doing,
 * and how long the Video runs.
 *
 * Two effects, doing two different jobs:
 *
 *   - The first answers the popup's heartbeat, its join handshake and a dot
 *     clicked on the glass. State and the click handler are
 *     read through a ref rather than captured in the dependencies: the
 *     speech-detector state changes constantly mid-take, and re-subscribing the
 *     channel on every change is the one failure mode a teleprompter can't have.
 *   - The second *pushes* state the moment it changes, so the glass is never a
 *     heartbeat behind the editor. Its dependencies are the primitives rather
 *     than the state object, so a re-render that produces an identical
 *     `{ videoId, capture }` sends nothing — which matters, because the
 *     speech detector re-renders far more often than it actually transitions.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  enableTeleprompterEditorMode,
  pushTeleprompterState,
} from "@/lib/teleprompter-window";
import type {
  CaptureStatus,
  ClipMarkIds,
  ClipMarks,
} from "@/lib/teleprompter-protocol";
import type { RecordingSession, TimelineItem } from "../clip-state-reducer";
import { useSessionClipMarks } from "../session-clip-marks";
import { useLatestSessionTranscript } from "../session-latest-transcript";
import { getTimelineItems, getTotalDuration } from "../video-editor-selectors";
import { isClip } from "../clip-utils";
import type { TeleprompterSuggestion } from "../suggestions-reducer";

export type TeleprompterEditorInput = {
  videoId: string | null;
  capture: CaptureStatus;
  /** The editor's clips and sessions, from which the session state is derived. */
  items: TimelineItem[];
  sessions: RecordingSession[];
  /** The Clip the editor's player is playing, or `null` when it is paused. */
  playingClipId: string | null;
  /**
   * The Suggestions tab's line while that tab is open (empty until the first
   * words arrive), with the Clips just before it, or `null`: the glass shows
   * it in place of the Script.
   */
  suggestion: TeleprompterSuggestion | null;
  /** A dot on the glass was clicked: play its Clip, or pause it. */
  onClipMarkClicked: (clipId: string) => void;
};

export function useTeleprompterEditorMode(input: TeleprompterEditorInput) {
  const { videoId, capture, playingClipId } = input;
  const suggestion = input.suggestion?.text ?? null;
  const suggestionId = input.suggestion?.id ?? null;
  const suggestionPreviousClips = input.suggestion?.previousClips ?? [];
  // One per clip in the current session — see `session-clip-marks.ts`.
  const { marks, markClipIds } = useSessionClipMarks(
    input.items,
    input.sessions
  );
  // See `session-latest-transcript.ts`.
  const latestTranscript = useLatestSessionTranscript(
    input.items,
    input.sessions
  );

  // The same length the editor shows under its player: the same items, the
  // same filter and the same sum as `clips` / `totalDuration` in video-editor.tsx.
  const videoLengthSeconds = useMemo(
    () => getTotalDuration(getTimelineItems(input.items).filter(isClip)),
    [input.items]
  );

  const state = {
    videoId,
    capture,
    marks,
    markClipIds,
    playingClipId,
    latestTranscript,
    videoLengthSeconds,
    suggestion,
    suggestionId,
    suggestionPreviousClips,
  };
  const ref = useRef(state);
  ref.current = state;
  const onClipMarkClickedRef = useRef(input.onClipMarkClicked);
  onClipMarkClickedRef.current = input.onClipMarkClicked;

  useEffect(
    () =>
      enableTeleprompterEditorMode(
        () => ref.current,
        (clipId) => onClipMarkClickedRef.current(clipId)
      ),
    []
  );

  // A fresh array every render would push on every frame of a take, so the
  // dependency is the arrays' *content*, flattened to a string.
  const marksKey = marks.join(",");
  const markClipIdsKey = markClipIds.join(",");
  const previousClipsKey = JSON.stringify(suggestionPreviousClips);
  useEffect(() => {
    pushTeleprompterState({
      videoId,
      capture,
      marks: marksKey === "" ? [] : (marksKey.split(",") as ClipMarks),
      markClipIds:
        markClipIdsKey === "" ? [] : (markClipIdsKey.split(",") as ClipMarkIds),
      playingClipId,
      latestTranscript,
      videoLengthSeconds,
      suggestion,
      suggestionId,
      suggestionPreviousClips: JSON.parse(previousClipsKey) as string[],
    });
  }, [
    videoId,
    capture,
    marksKey,
    markClipIdsKey,
    playingClipId,
    latestTranscript,
    videoLengthSeconds,
    suggestion,
    suggestionId,
    previousClipsKey,
  ]);
}
