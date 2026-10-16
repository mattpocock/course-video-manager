import type {
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import type { InsertionPoint } from "@/services/clip-service";
import type { AskEditor } from "./ingest.server";

const NONE: PlacedTake = { clips: [], transcriptionJobId: null };

/**
 * The recorder client holds no insertion point: the editor owns it (ADR
 * 0044). When speech ends the editors open on the Video are asked where to
 * save it (`speech-ended`); it is saved where one answers (`placeTake`), and
 * that editor hears back the Clips. With no answer by `timeoutMs` (no editor open, or
 * none following that Recording Session) the speech is saved after the
 * Video's last item and the editors are told (`clips-saved`): a save never
 * waits on an editor.
 */
export const createTakePlacer = (o: {
  timeoutMs: number;
  publish: (videoId: string, message: CvmRecorderMessage) => void;
}) => {
  /** Per Recording Session: the speech waiting for an editor to say where. */
  const asking = new Map<
    string,
    { videoId: string; answer: (point: InsertionPoint) => Promise<PlacedTake> }
  >();
  return {
    /** For one event's save: the asking, and the answer to the editor. */
    forEvent: () => {
      let answered: ((placed: PlacedTake) => void) | undefined;
      const askEditor: AskEditor = (videoId, recordingSessionId, clip) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            asking.delete(recordingSessionId);
            resolve(null);
          }, o.timeoutMs);
          asking.set(recordingSessionId, {
            videoId,
            answer: (point) => {
              clearTimeout(timer);
              asking.delete(recordingSessionId);
              resolve(point);
              return new Promise((placed) => (answered = placed));
            },
          });
          o.publish(videoId, {
            type: "speech-ended",
            recordingSessionId,
            clip,
          });
        });
      /** None placed (or the save failed: the replay asks again). */
      const settle = (placed?: PlacedTake) => answered?.(placed ?? NONE);
      return { askEditor, settle };
    },

    /**
     * An editor says where to save the speech of a Recording Session it
     * heard end, and hears back the Clips saved there; none when nothing of
     * it waits (too short, saved already, or answered by another editor).
     */
    placeTake(
      videoId: string,
      recordingSessionId: string,
      insertionPoint: InsertionPoint
    ): Promise<PlacedTake> {
      const waiting = asking.get(recordingSessionId);
      if (!waiting || waiting.videoId !== videoId) return Promise.resolve(NONE);
      return waiting.answer(insertionPoint);
    },
  };
};
