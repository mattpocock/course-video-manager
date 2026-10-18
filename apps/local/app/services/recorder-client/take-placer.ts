import type {
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import type { InsertionPoint } from "@/services/clip-service";
import type { AskEditor } from "./ingest.server";

/**
 * The editor following a Recording Session is going away (New Short, another
 * page, a reload), its Insertion Point as it went.
 */
export type EditorLeft = {
  recordingSessionId: string;
  insertionPoint: InsertionPoint;
};

const NONE: PlacedTake = { clips: [], transcriptionJobId: null };

/**
 * The recorder client holds no insertion point: the editor owns it (ADR
 * 0044). When speech ends the editors open on the Video are asked where to
 * save it (`speech-ended`); it is saved where one answers (`placeTake`), and
 * that editor hears back the Clips. With no answer by `timeoutMs` (no editor open, or
 * none following that Recording Session) the speech is saved after the
 * Video's last item and the editors are told (`clips-saved`): a save never
 * waits on an editor.
 *
 * An editor that leaves mid-take (New Short, another page, a reload) says
 * where it was (`editorLeft`): the rest of that Recording Session's speech is
 * saved there, each Take after the one before, as that editor would have
 * placed it, instead of after the Video's last item.
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
  /** Per Recording Session whose editor left: where its next speech goes. */
  const left = new Map<string, { videoId: string; point: InsertionPoint }>();
  return {
    /** For one event's save: the asking, and the answer to the editor. */
    forEvent: (event: { type: string; recordingSessionId: string }) => {
      let answered: ((placed: PlacedTake) => void) | undefined;
      const askEditor: AskEditor = (videoId, recordingSessionId, clip) => {
        const leftAt = left.get(recordingSessionId);
        if (leftAt?.videoId === videoId) return Promise.resolve(leftAt.point);
        return new Promise((resolve) => {
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
      };
      /** None placed (or the save failed: the replay asks again). */
      const settle = (placed?: PlacedTake) => {
        answered?.(placed ?? NONE);
        const id = event.recordingSessionId;
        // Its last event: nothing more of it to place.
        if (
          event.type === "recording-stopped" ||
          event.type === "recording-crashed"
        )
          return void left.delete(id);
        const leftAt = left.get(id);
        const last = placed?.clips.at(-1);
        if (leftAt && last)
          left.set(id, {
            ...leftAt,
            point: { type: "after-clip", databaseClipId: last.id },
          });
      };
      return { askEditor, settle };
    },

    /**
     * The editor following a Recording Session left: its speech from now on
     * is saved at `point`, the editor's Insertion Point as it went, and a
     * speech already waiting for it is answered there.
     */
    editorLeft(
      videoId: string,
      { recordingSessionId, insertionPoint: point }: EditorLeft
    ) {
      left.set(recordingSessionId, { videoId, point });
      const waiting = asking.get(recordingSessionId);
      if (waiting?.videoId === videoId) void waiting.answer(point);
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
