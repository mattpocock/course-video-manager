import { fromPartial } from "@total-typescript/shoehorn";
import { vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { InsertionPoint } from "@/services/clip-service";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipReducerAction,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import {
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import type {
  CvmRecorderMessage,
  SavedRecorderClip,
} from "./cvm-recorder-wire";
import { cvmRecorderTakeSaver } from "./cvm-recorder-take-saver";
import { takesSavedInto, type TakeSaver } from "./take-saver";
import {
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

/**
 * A take through the CVM recorder's adapter (`cvmRecorderReducer`,
 * `use-cvm-recorder.ts`), reaching the clip reducer through its effects as
 * the hook sends them. It saves through its real `TakeSaver`, which the clip
 * reducer's `save-takes` starts as the edit route does, onto a model of the
 * app server: each save is placed where the editor says with it
 * (`place-take`), and the database's order must end up the editor's. Saving
 * is async: call these under `vi.useFakeTimers()`.
 */

/** Lets the saver's requests answer. */
export const settle = () => vi.advanceTimersByTimeAsync(500);

type ClipTester = ReducerTester<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
>;

export const dbClip = (id: string) =>
  fromPartial<SavedRecorderClip>({
    id: id as DatabaseId,
    videoFilename: "footage.mkv",
    sourceStartTime: 1,
    sourceEndTime: 2,
    scene: null,
    profile: null,
    pauseType: "none",
    zoomType: "none",
    diagramSnapshotId: null,
    transcriptionStatus: "queued",
  });

const saved = (id: string): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    pauseType: "none",
  });

/**
 * The editor, and the app server's rows: saved Clips in their order, each
 * archived or not, placed after the item the editor resolves its insertion
 * point to (`placeClips`; one after an archived Clip goes where it stood).
 */
export const editor = (items: string[]) => {
  const clips: ClipTester = new ReducerTester(clipStateReducer, {
    clipIdsWithTranscriptWords: new Set<DatabaseId>(),
    items: items.map(saved),
    insertionPoint: { type: "end" },
    insertionOrder: 0,
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    jobEventCursor: 0,
    micOffsetRefusal: null,
  });
  const rows = items.map((id) => ({ id, archived: false }));
  let effectsSeen = 0;
  let saveTakes: TakeSaver | null = null;
  /** The app server, and the Recorder's saver, carry out what the editor asked. */
  const serve = () => {
    while (effectsSeen < clips.getEffects().length) {
      const effect = clips.getEffects()[effectsSeen++]!;
      if (effect.type === "archive-clips" || effect.type === "unarchive-clips")
        for (const row of rows)
          if (effect.clipIds.includes(row.id as DatabaseId))
            row.archived = effect.type === "archive-clips";
      if (effect.type === "save-takes") {
        const { type: _, ...session } = effect;
        saveTakes!(
          session,
          takesSavedInto(session, () => clips.getState(), send)
        );
      }
    }
  };
  const send = (action: ClipReducerAction) => {
    clips.send(action);
    serve();
  };
  /** Saves a Clip where the editor says, as the save call carries it. */
  const save = (clipId: string, point: InsertionPoint) => {
    const after =
      point.type === "start"
        ? -1
        : rows.findIndex(
            (r) =>
              r.id ===
              (point.type === "after-clip"
                ? point.databaseClipId
                : point.chapterId)
          );
    rows.splice(after + 1, 0, { id: clipId, archived: false });
    return dbClip(clipId);
  };
  return {
    clips,
    send,
    save,
    /** The Recorder connecting: its saver saves the Takes the editor asks it to. */
    savesWith: (saver: TakeSaver) => {
      saveTakes = saver;
    },
    database: () => rows.filter((r) => !r.archived).map((r) => r.id),
  };
};
export type Editor = ReturnType<typeof editor>;

export type Recorder = {
  name: string;
  /** The editor opens; `midTake`: while the Recorder is already recording. */
  connect: (
    e: Editor,
    opts?: { midTake?: boolean }
  ) => {
    /** Recording Session `n` (1 by default) starts, past the silence before the first word. */
    startRecording: (n?: number) => void;
    /** Record pressed without a fresh AV Calibration: the gate refuses it. */
    refusedRecord: () => void;
    /** Speech starts, not yet long enough for a Clip. */
    speak: () => void;
    /** The speech goes on long enough for a Clip. */
    holdSpeech: () => void;
    /** Speech long enough for a Clip. */
    startTake: () => void;
    /** The speech ends, with no Clip made. */
    endSpeech: () => void;
    /** The speech ends, and its Clip is saved where the editor says. */
    saveTake: (clipId: string) => Promise<void>;
    /** Recording stops, and the session timeout runs out. */
    stopRecording: () => void;
    /** The editor loses the Recorder and finds it again: the app server's events. */
    reconnect: () => void;
    /** What the editor shows of the speech. */
    speech: () => FrontendSpeechDetectorState;
    /** How often the editor has asked the Recorder to stop. */
    stops: () => number;
  };
};

/** The session timeout after Stop, as `start-session-timeout` reports it. */
const timeOut = (e: Editor) => {
  const timeout = e.clips
    .getEffects()
    .findLast((x) => x.type === "start-session-timeout");
  if (timeout?.type === "start-session-timeout")
    e.send({ type: "session-polling-complete", sessionId: timeout.sessionId });
};

/** The edit route's `onClipAudioWindowClosed`. */
const closeTakeWindow = (e: Editor) => {
  const session = e.clips
    .getState()
    .sessions.find((s) => s.status === "recording");
  if (session)
    e.send({
      type: "clip-audio-window-closed",
      sessionId: session.id,
      activeDiagramId: null,
      diagramFocused: false,
      ts: 0,
    });
};

export const recordingSession = (n: number) => `session-${n}`;

/**
 * The CVM recorder: messages into its adapter, whose effects reach the clip
 * reducer as `use-cvm-recorder.ts` sends them. `place-take` asks the app
 * server, through the CVM recorder's saver, to save the speech where the
 * editor says, and answers with the Clip `willSave` names, if any.
 */
export const cvmAdapter = (e: Editor) => {
  const recorder = new ReducerTester(
    cvmRecorderReducer,
    createInitialCvmRecorderState()
  );
  let effectsSeen = 0;
  const pending: string[] = [];
  // `place-take`: the app server saves the speech where the editor says.
  const saver = cvmRecorderTakeSaver({
    placeTake: async (_recordingSessionId, insertionPoint) => {
      const clipId = pending.shift();
      return clipId
        ? {
            clips: [e.save(clipId, insertionPoint)],
            transcriptionJobId: `job-${clipId}`,
          }
        : { clips: [], transcriptionJobId: null };
    },
  });
  e.savesWith(saver.saveTakes);
  const run = () => {
    const effects = recorder.getEffects();
    for (const effect of effects.slice(effectsSeen)) {
      effectsSeen += 1;
      switch (effect.type) {
        case "start-session":
          e.send({
            type: "recording-started",
            outputPath: effect.recordingSessionId,
            silenceLength: effect.silenceLength,
          });
          break;
        case "stop-session":
          e.send({ type: "recording-stopped" });
          break;
        case "start-take":
          e.send({
            type: "new-optimistic-clip-detected",
            scene: null,
            profile: null,
            soundDetectionId: effect.soundDetectionId,
          });
          break;
        case "close-take-window":
          closeTakeWindow(e);
          break;
        case "place-take":
          saver.takeEnded(effect.recordingSessionId);
          break;
        case "show-saved-clips":
          e.send({
            type: "new-database-clips",
            clips: effect.clips,
            outputPath: effect.recordingSessionId,
            transcriptionJobId: effect.transcriptionJobId,
          });
          break;
        case "stop-recording":
        case "log-unexpected":
        case "send-silence-length":
        case "retry-camera":
        case "retry-screen":
          break;
      }
    }
  };
  const hear = (action: cvmRecorderReducer.Action) => {
    recorder.send(action);
    run();
  };
  let takes = 0;
  const heard = (message: CvmRecorderMessage) =>
    hear({ type: "recorder-message-heard", message });
  const took = (recordingSessionId: string) =>
    heard({
      type: "take-started",
      recordingSessionId,
      takeId: `${recordingSessionId}:${++takes}`,
      startTime: 0,
    });
  return {
    recorder,
    hear: heard,
    /** Speech the recorder service calls a Take: `speech-started`, then `take-started`. */
    take: (recordingSessionId: string) => {
      heard({ type: "speech-started", recordingSessionId });
      took(recordingSessionId);
    },
    /** The speech going on is a Take now. */
    took,
    /** The next speech that ends makes this Clip. */
    willSave: (clipId: string) => pending.push(clipId),
  };
};

export const status = (
  recordingSessionId: string | null
): CvmRecorderMessage => ({
  type: "recorder-status",
  reachable: true,
  problem: null,
  recordingSessionId,
  previews: { camera: "c", screen: "s" },
  still: "still",
});

export const stopped = (id: string): CvmRecorderMessage => ({
  type: "recording-stopped",
  recordingSessionId: id,
  errors: [],
  crashed: false,
  framesLost: { camera: 0, screen: 0 },
  lostFrameSpans: [],
});

export const cvm: Recorder = {
  name: "CVM recorder",
  connect: (e, opts) => {
    const adapter = cvmAdapter(e);
    let id = recordingSession(1);
    // The page opens, and hears what the recorder is doing.
    if (opts?.midTake) {
      adapter.hear(status(id));
      // The stop lands.
      adapter.hear(status(null));
      adapter.hear(stopped(id));
    } else adapter.hear(status(null));
    const speak = () =>
      adapter.hear({ type: "speech-started", recordingSessionId: id });
    const holdSpeech = () => adapter.took(id);
    const endSpeech = () =>
      adapter.hear({ type: "speech-ended", recordingSessionId: id });
    return {
      startRecording: (n = 1) => {
        id = recordingSession(n);
        adapter.hear({
          type: "recording-started",
          recordingSessionId: id,
          silenceLength: "short",
          micFile: "mic.mkv",
        });
        adapter.hear({ type: "warmed-up", recordingSessionId: id });
      },
      refusedRecord: () =>
        adapter.hear({
          type: "recorder-failed",
          message: "Record refused: AV Calibration expired.",
        }),
      speak,
      holdSpeech,
      startTake: () => adapter.take(id),
      endSpeech,
      saveTake: async (clipId) => {
        adapter.willSave(clipId);
        endSpeech();
        await settle();
      },
      stopRecording: () => {
        // The app server says it stopped before the stop event lands.
        adapter.hear(status(null));
        adapter.hear(stopped(id));
        timeOut(e);
      },
      // The app server's events reconnect, and say what records.
      reconnect: () =>
        adapter.hear(status(adapter.recorder.getState().recordingSessionId)),
      speech: () =>
        toFrontendSpeechDetectorState(adapter.recorder.getState().speech),
      stops: () =>
        adapter.recorder.getEffects().filter((x) => x.type === "stop-recording")
          .length,
    };
  },
};

export const shown = (e: Editor) =>
  e.clips
    .getState()
    .items.filter((i) => !("shouldArchive" in i && i.shouldArchive))
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

export const archived = (e: Editor) =>
  e.clips
    .getState()
    .items.filter((i) => "shouldArchive" in i && i.shouldArchive)
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

export const frontendIdOf = (e: Editor, id: string) =>
  e.clips
    .getState()
    .items.find((i) => i.type === "on-database" && i.databaseId === id)!
    .frontendId;
