/**
 * Keep the teleprompter popup in step with this editor.
 *
 * The popup has no picker, so this is the only way it learns which video to
 * show, what capture is doing, and which of Script or Beats you're looking at.
 *
 * Two effects, doing two different jobs:
 *
 *   - The first answers the popup's heartbeat and its join handshake. State is
 *     read through a ref rather than captured in the dependencies: the
 *     speech-detector state changes constantly mid-take, and re-subscribing the
 *     channel on every change is the one failure mode a teleprompter can't have.
 *   - The second *pushes* state the moment it changes, so the glass is never a
 *     heartbeat behind the editor. Its dependencies are the primitives rather
 *     than the state object, so a re-render that produces an identical
 *     `{ videoId, capture, tab }` sends nothing — which matters, because the
 *     speech detector re-renders far more often than it actually transitions.
 */
import { useEffect, useRef } from "react";
import {
  enableTeleprompterEditorMode,
  pushTeleprompterState,
} from "@/lib/teleprompter-window";
import type {
  CaptureStatus,
  UnresolvedClips,
} from "@/lib/teleprompter-protocol";
import type { BeatTab } from "../beat-tab";

export type TeleprompterEditorState = {
  videoId: string | null;
  capture: CaptureStatus;
  tab: BeatTab;
  /** PROTOTYPE — see `prototype-unresolved-clips.ts`. */
  unresolved: UnresolvedClips;
};

export function useTeleprompterEditorMode(state: TeleprompterEditorState) {
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => enableTeleprompterEditorMode(() => ref.current), []);

  const { videoId, capture, tab, unresolved } = state;
  // A fresh array every render would push on every frame of a take, so the
  // dependency is the array's *content*, flattened to a string.
  const unresolvedKey = unresolved.join(",");
  useEffect(() => {
    pushTeleprompterState({
      videoId,
      capture,
      tab,
      unresolved:
        unresolvedKey === ""
          ? []
          : (unresolvedKey.split(",") as UnresolvedClips),
    });
  }, [videoId, capture, tab, unresolvedKey]);
}
