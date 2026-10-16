import type { DB } from "@/db/schema";
import type { ClipRecordingSession } from "@/packages/clip-source";
import type {
  ClipReducerAction,
  ClipReducerEffect,
  ClipReducerState,
} from "./clip-state-reducer.types";

/** The Recording Session whose Takes the clip reducer asks to have saved. */
export type SavingSession = Omit<
  Extract<ClipReducerEffect, { type: "save-takes" }>,
  "type"
>;

/** A saved Clip; a CVM recorder Clip comes with its Recording Session. */
export type SavedClip = DB.Clip & {
  recordingSession?: ClipRecordingSession | null;
};

/** What a saver tells the editor, and asks of it, while it saves. */
export interface TakesSaved {
  /** Where the editor would put a Clip now: OBS's poll and `place-take` save there. */
  where(): Pick<ClipReducerState, "insertionPoint" | "items">;
  /** The clip reducer is finished with this Recording Session. */
  isDone(): boolean;
  /** Clips saved from the Session's Takes, and the Job transcribing them. */
  saved(clips: SavedClip[], transcriptionJobId: string): void;
  /** Saving cannot go on (the Version was Submitted mid-session, #1403). */
  failed(message: string): void;
}

/**
 * How a Recorder's Takes become saved Clips (#2201). The clip reducer asks
 * for `save-takes` once per Recording Session and never knows which
 * Recorder made it: OBS's saver polls its file (`obs-take-saver.ts`), the
 * CVM recorder's answers `place-take` per speech
 * (`cvm-recorder-take-saver.ts`). Returns how to stop saving.
 */
export type TakeSaver = (
  session: SavingSession,
  takes: TakesSaved
) => () => void;

/** The `TakesSaved` of a `save-takes` effect, onto the clip reducer. */
export const takesSavedInto = (
  session: SavingSession,
  getState: () => ClipReducerState,
  dispatch: (action: ClipReducerAction) => void
): TakesSaved => ({
  where: () => {
    const { insertionPoint, items } = getState();
    return { insertionPoint, items };
  },
  isDone: () =>
    getState().sessions.find((s) => s.id === session.sessionId)?.status ===
    "done",
  saved: (clips, transcriptionJobId) =>
    dispatch({
      type: "new-database-clips",
      clips,
      outputPath: session.outputPath,
      transcriptionJobId,
    }),
  failed: (message) =>
    dispatch({ type: "effect-failed", effectType: "save-takes", message }),
});
