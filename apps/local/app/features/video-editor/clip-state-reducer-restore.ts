import type { clipStateReducer } from "./clip-state-reducer";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
} from "./clip-state-reducer.types";
import { nowMs } from "@/packages/clock";

type RestoreClip = Extract<clipStateReducer.Action, { type: "restore-clip" }>;
type ClipRestoreFailed = Extract<
  clipStateReducer.Action,
  { type: "clip-restore-failed" }
>;

/**
 * Restore an archived Clip, optimistically. Any Clip restores, whichever
 * Recorder filmed it: a Clip's Recorder is its own (ADR 0036).
 */
export const handleRestoreClip = (
  state: clipStateReducer.State,
  action: RestoreClip,
  exec: Parameters<typeof clipStateReducer>[2]
): clipStateReducer.State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);

  if (
    !item ||
    (item.type !== "optimistically-added" && item.type !== "on-database") ||
    !item.shouldArchive
  ) {
    return state;
  }

  if (item.type === "on-database") {
    exec({ type: "unarchive-clips", clipIds: [item.databaseId] });
  }

  return {
    ...state,
    items: state.items.map((c) => {
      if (c.frontendId === action.clipId) {
        const { shouldArchive: _, ...rest } = c as
          ClipOnDatabase | ClipOptimisticallyAdded;
        return rest;
      }
      return c;
    }),
  };
};

/**
 * The server did not restore these Clips: archive them again so the editor
 * matches the database. The failure is fatal, like every other.
 */
export const handleClipRestoreFailed = (
  state: clipStateReducer.State,
  action: ClipRestoreFailed
): clipStateReducer.State => {
  const failed = new Set<string>(action.clipIds);
  const items = state.items.map((item) =>
    item.type === "on-database" && failed.has(item.databaseId)
      ? { ...item, shouldArchive: true }
      : item
  );

  return {
    ...state,
    items,
    error: {
      message: action.message,
      effectType: "unarchive-clips",
      timestamp: nowMs(),
    },
  };
};
