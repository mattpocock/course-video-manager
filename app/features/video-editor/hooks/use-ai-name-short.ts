import { useEffect, useRef } from "react";
import type { ClipReducerState } from "@/features/video-editor/clip-state-reducer";

export function useAiNameShort(opts: {
  videoId: string;
  format: string;
  clipState: ClipReducerState;
  onNamed: () => void;
}) {
  const hasTriggeredRef = useRef(false);
  const wasRecordingRef = useRef(false);
  const onNamedRef = useRef(opts.onNamed);
  onNamedRef.current = opts.onNamed;

  useEffect(() => {
    if (opts.format !== "short") return;

    const hasSessions = opts.clipState.sessions.length > 0;
    const hasRecordingSession = opts.clipState.sessions.some(
      (s) => s.status === "recording" || s.status === "polling"
    );

    if (hasRecordingSession) {
      wasRecordingRef.current = true;
    }

    const allDone =
      hasSessions && opts.clipState.sessions.every((s) => s.status === "done");

    if (wasRecordingRef.current && allDone && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;

      fetch(`/api/videos/${opts.videoId}/ai-name-describe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.title) onNamedRef.current();
        })
        .catch(() => {});
    }
  }, [opts.format, opts.videoId, opts.clipState.sessions]);
}
