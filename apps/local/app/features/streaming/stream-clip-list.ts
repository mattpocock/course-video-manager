import type {
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  TimelineItem,
} from "@/features/video-editor/clip-state-reducer";
import { isTranscriptionPending } from "@/features/videos/transcription-status";

/** One row of the Streaming tab's compact, read-only Clip list. */
export type StreamClipRow =
  | {
      kind: "clip";
      id: FrontendId;
      /** Null for an Effect Clip not yet saved. */
      databaseId: DatabaseId | null;
      /** The transcript, or what stands in for it while there is none. */
      text: string;
    }
  | {
      /** An Optimistic Clip: a Take whose Clip is not saved yet. */
      kind: "take";
      id: FrontendId;
      /** Its Recording Session is still recording (speech detection runs). */
      recording: boolean;
    }
  | { kind: "chapter"; id: FrontendId; name: string }
  | { kind: "insertion-point" };

const isListed = (item: TimelineItem): boolean => {
  switch (item.type) {
    case "on-database":
    case "chapter-optimistically-added":
      return !item.shouldArchive;
    case "optimistically-added":
      return !item.shouldArchive && !item.isOrphaned;
    case "effect-clip-optimistically-added":
    case "chapter-on-database":
      return true;
  }
};

const clipText = (
  item: Extract<TimelineItem, { type: "on-database" }>
): string => {
  if (item.text) return item.text;
  if (item.transcriptionStatus === "failed") return "Transcription failed";
  if (isTranscriptionPending(item.transcriptionStatus)) return "Transcribing…";
  return "No transcript";
};

const toRow = (
  item: TimelineItem,
  recordingSessions: Set<string>
): StreamClipRow => {
  switch (item.type) {
    case "on-database":
      return {
        kind: "clip",
        id: item.frontendId,
        databaseId: item.databaseId,
        text: clipText(item),
      };
    case "effect-clip-optimistically-added":
      return {
        kind: "clip",
        id: item.frontendId,
        databaseId: null,
        text: item.text,
      };
    case "optimistically-added":
      return {
        kind: "take",
        id: item.frontendId,
        recording: recordingSessions.has(item.sessionId),
      };
    case "chapter-on-database":
    case "chapter-optimistically-added":
      return { kind: "chapter", id: item.frontendId, name: item.name };
  }
};

/**
 * How many listed items come before the Insertion Point. One it names that
 * is not listed (archived, or an orphaned Take) stands where the nearest
 * listed item before it stands, as the editor's timeline draws it.
 */
const insertionIndex = (
  items: TimelineItem[],
  insertionPoint: FrontendInsertionPoint
): number => {
  const listedCount = (upTo: number) =>
    items.slice(0, upTo).filter(isListed).length;
  switch (insertionPoint.type) {
    case "start":
      return 0;
    case "end":
      return listedCount(items.length);
    case "after-clip":
    case "after-chapter": {
      const id =
        insertionPoint.type === "after-clip"
          ? insertionPoint.frontendClipId
          : insertionPoint.frontendChapterId;
      const at = items.findIndex((item) => item.frontendId === id);
      return at === -1 ? listedCount(items.length) : listedCount(at + 1);
    }
  }
};

/**
 * The Streaming tab's Clip list: the clip reducer's items in timeline order,
 * Takes forming as Optimistic Clips, and the Insertion Point. Archived Clips
 * and orphaned Takes are left out: the list has no restore and no editing.
 */
export const streamClipList = (input: {
  items: TimelineItem[];
  sessions: RecordingSession[];
  insertionPoint: FrontendInsertionPoint;
}): StreamClipRow[] => {
  const recordingSessions = new Set<string>(
    input.sessions.filter((s) => s.status === "recording").map((s) => s.id)
  );
  const rows = input.items
    .filter(isListed)
    .map((item) => toRow(item, recordingSessions));
  rows.splice(insertionIndex(input.items, input.insertionPoint), 0, {
    kind: "insertion-point",
  });
  return rows;
};
