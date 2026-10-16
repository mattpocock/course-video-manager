import {
  resolveInsertionPoint,
  type InsertionPoint,
} from "@/services/clip-service";
import type { PlacedTake } from "./cvm-recorder-wire";
import type { TakeSaver, TakesSaved } from "./take-saver";

/**
 * The CVM recorder's `TakeSaver`. Its Recording Session has no file to
 * poll: the app server asks where each speech goes as it ends, and this
 * answers (`place-take`) with where the editor would put a Clip now, then
 * hands the Clips saved there to the editor. The clip reducer's Recording
 * Session's `outputPath` is the recorder's `recordingSessionId`.
 */
export const cvmRecorderTakeSaver = (o: {
  /** `POST /api/videos/:id/recorder/place-take`. */
  placeTake: (
    recordingSessionId: string,
    insertionPoint: InsertionPoint
  ) => Promise<PlacedTake>;
}) => {
  const saving = new Map<string, TakesSaved>();
  const saveTakes: TakeSaver = (session, takes) => {
    saving.set(session.outputPath, takes);
    return () => {
      if (saving.get(session.outputPath) === takes)
        saving.delete(session.outputPath);
    };
  };
  return {
    saveTakes,
    /** The speech of a Take ended (the `place-take` effect). */
    takeEnded: (recordingSessionId: string) => {
      const takes = saving.get(recordingSessionId);
      if (!takes) {
        // Not lost: unanswered, the app server saves it after the Video's
        // last item and says so (`clips-saved`).
        console.warn(
          `No Recording Session saving takes for ${recordingSessionId}: place-take ignored`
        );
        return;
      }
      Promise.resolve()
        .then(() => {
          const { insertionPoint, items } = takes.where();
          return o.placeTake(
            recordingSessionId,
            resolveInsertionPoint(insertionPoint, items)
          );
        })
        .then(({ clips, transcriptionJobId }) => {
          if (clips.length > 0 && transcriptionJobId)
            takes.saved(clips, transcriptionJobId);
        })
        .catch((error: unknown) =>
          // Not lost: the app server saves it after the Video's last item
          // and says so (`clips-saved`).
          console.error("Could not tell the recorder where to save", error)
        );
    },
  };
};
