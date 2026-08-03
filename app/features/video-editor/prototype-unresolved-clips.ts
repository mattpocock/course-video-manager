/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * Every optimistic clip that hasn't found a database clip to pair with, oldest
 * first, for the teleprompter's status display.
 *
 * This exists to catch one specific failure: the frontend speech detector and
 * the backend's FFmpeg silence detection disagreeing. The microphone picks up
 * a little audio, an optimistic clip is created, and no database clip ever
 * arrives to match it. On the glass that shows up as a mark that doesn't go
 * away.
 *
 * Derived here rather than on the glass because clips live in this window's
 * reducer and the popup is a pure slave (see `teleprompter-protocol.ts`).
 *
 * Scoped to the newest recording session, so pressing record wipes the slate:
 * what's on the glass is always this take's exposure, never last take's.
 */
import { useMemo } from "react";
import type { UnresolvedClips } from "@/lib/teleprompter-protocol";
import type { RecordingSession, TimelineItem } from "./clip-state-reducer";

export function usePrototypeUnresolvedClips(
  items: TimelineItem[],
  sessions: RecordingSession[]
): UnresolvedClips {
  // The newest session is the one being filmed. Until there is one, there is
  // nothing to report.
  const currentSessionId = sessions.at(-1)?.id ?? null;

  return useMemo(() => {
    if (currentSessionId === null) return [];

    const unresolved: {
      insertionOrder: number;
      state: "pending" | "orphaned" | "deleted";
    }[] = [];

    for (const item of items) {
      // Only optimistic clips can be unresolved. Anything on the database has,
      // by definition, found its home and is no longer interesting here.
      if (item.type !== "optimistically-added") continue;
      if (item.sessionId !== currentSessionId) continue;

      // Deleted wins over orphaned: a clip you chose to throw away not
      // arriving is not a failure, so it shouldn't read as one.
      const state = item.shouldArchive
        ? "deleted"
        : item.isOrphaned
          ? "orphaned"
          : "pending";

      unresolved.push({ insertionOrder: item.insertionOrder, state });
    }

    return unresolved
      .sort((a, b) => a.insertionOrder - b.insertionOrder)
      .map((clip) => clip.state);
  }, [items, currentSessionId]);
}
