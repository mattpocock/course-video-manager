/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * The recording session reduced to three numbers for the teleprompter glass.
 * Derived here rather than on the glass because sessions live in this window's
 * reducer and the popup is a pure slave (see `teleprompter-protocol.ts`).
 *
 * Scoped to the *newest* session, per the answer to Q2: each press of record
 * starts the counts again. Two known limits, both inherited from the fact that
 * sessions are in-memory reducer state:
 *
 *   - A page reload mid-session resets everything to zero.
 *   - `settled` is a diff against a baseline taken when the session began,
 *     because `ClipOnDatabase.sessionId` is only populated for clips that were
 *     archived — a normally-paired clip keeps no record of which session made
 *     it. Deleting an *older* clip mid-session therefore undercounts, which is
 *     why it's clamped at zero.
 */
import { useRef } from "react";
import type { SessionCounts } from "@/lib/teleprompter-protocol";
import type {
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";

const EMPTY: SessionCounts = { pending: 0, settled: 0, orphaned: 0 };

/** Clips that have made it to the database and haven't been deleted. */
function liveDatabaseClipCount(items: TimelineItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.type === "on-database" && !item.shouldArchive) n++;
  }
  return n;
}

export function usePrototypeSessionCounts(
  items: TimelineItem[],
  sessions: RecordingSession[]
): SessionCounts {
  // The newest session is the one being filmed right now.
  const current = sessions.at(-1) ?? null;

  const baseline = useRef<{ sessionId: SessionId | null; dbCount: number }>({
    sessionId: null,
    dbCount: 0,
  });

  const dbCount = liveDatabaseClipCount(items);

  if (current === null) {
    baseline.current = { sessionId: null, dbCount };
    return EMPTY;
  }

  // A new session: everything from here is what today's take produced.
  if (baseline.current.sessionId !== current.id) {
    baseline.current = { sessionId: current.id, dbCount };
  }

  let pending = 0;
  let orphaned = 0;
  for (const item of items) {
    if (item.type !== "optimistically-added") continue;
    if (item.sessionId !== current.id) continue;
    if (item.shouldArchive) continue;
    if (item.isOrphaned) orphaned++;
    else pending++;
  }

  return {
    pending,
    orphaned,
    settled: Math.max(0, dbCount - baseline.current.dbCount),
  };
}
