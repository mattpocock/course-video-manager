/**
 * Announce this editor to the teleprompter popup, and keep answering its pings.
 *
 * The popup has no picker, so this is the only way it learns which video to
 * show, what capture is doing, and which of Script or Beats you're looking at.
 *
 * State is read through a ref at pong time rather than captured in the effect's
 * dependencies: the speech-detector state changes constantly mid-take, and
 * re-subscribing the channel on every change is the one failure mode a
 * teleprompter can't have.
 */
import { useEffect, useRef } from "react";
import { enableTeleprompterEditorMode } from "@/lib/teleprompter-window";
import type { CaptureStatus } from "@/lib/teleprompter-protocol";
import type { BeatTab } from "../beat-tab";

export type TeleprompterEditorState = {
  videoId: string | null;
  capture: CaptureStatus;
  tab: BeatTab;
};

export function useTeleprompterEditorMode(state: TeleprompterEditorState) {
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => enableTeleprompterEditorMode(() => ref.current), []);
}
