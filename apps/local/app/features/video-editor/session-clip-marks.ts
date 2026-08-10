/**
 * One mark per clip in the current recording session, oldest first, for the
 * teleprompter's session display (`app/features/teleprompter/session-marks.tsx`).
 *
 * This exists to catch one specific failure: the frontend speech detector and
 * the backend's FFmpeg silence detection disagreeing. The microphone picks up a
 * little audio, an optimistic clip is created, and no database clip ever
 * arrives to match it. On the glass that shows up as a mark that never fills
 * in — every other mark fills as its clip lands, so a hollow one left behind is
 * the leak.
 *
 * Derived here rather than on the glass because clips live in this window's
 * reducer and the popup is a pure slave (see `teleprompter-protocol.ts`).
 *
 * Scoped to the newest recording session, so pressing record wipes the slate:
 * what's on the glass is always this take's exposure, never last take's.
 */
import { useMemo } from "react";
import type { ClipMarks, ClipMarkState } from "@/lib/teleprompter-protocol";
import type { RecordingSession, TimelineItem } from "./clip-state-reducer";

export function getSessionClipMarks(
  items: TimelineItem[],
  sessions: RecordingSession[]
): ClipMarks {
  // The newest session is the one being filmed. Until there is one, there is
  // nothing to report.
  const currentSessionId = sessions.at(-1)?.id ?? null;
  if (currentSessionId === null) return [];

  const marks: { insertionOrder: number; state: ClipMarkState }[] = [];

  for (const item of items) {
    // A database clip keeps the `sessionId` of the optimistic clip it was
    // paired from, so this follows a clip across both halves of its life.
    // Clips loaded from the database on page load carry no session and are
    // correctly invisible here.
    if (item.type === "optimistically-added") {
      if (item.sessionId !== currentSessionId) continue;
      // Deleted wins over orphaned: a clip you chose to throw away not
      // arriving is not a failure, so it shouldn't read as one.
      marks.push({
        insertionOrder: item.insertionOrder,
        state: item.shouldArchive
          ? "deleted-pending"
          : item.isOrphaned
            ? "orphaned"
            : "pending",
      });
    } else if (item.type === "on-database") {
      if (item.sessionId !== currentSessionId) continue;
      marks.push({
        // Paired clips inherit their optimistic clip's insertion order, so this
        // stays comparable with the pending ones above and a mark fills in
        // where it already sat rather than jumping position.
        insertionOrder: item.insertionOrder ?? 0,
        state: item.shouldArchive ? "deleted-landed" : "landed",
      });
    }
  }

  return marks
    .sort((a, b) => a.insertionOrder - b.insertionOrder)
    .map((mark) => mark.state);
}

export function useSessionClipMarks(
  items: TimelineItem[],
  sessions: RecordingSession[]
): ClipMarks {
  return useMemo(() => getSessionClipMarks(items, sessions), [items, sessions]);
}
