import { fromPartial } from "@total-typescript/shoehorn";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  resolveInsertionPoint,
  type InsertionPoint,
} from "@/services/clip-service";
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
import {
  CALIBRATION_VALIDITY_MS,
  type LastPassedCalibration,
} from "@/av-calibration-constants";
import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";
import {
  createInitialOBSConnectorState,
  obsConnectorReducer,
} from "./obs-connector-reducer";
import {
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
  type speechDetectorReducer,
} from "./speech-detector-reducer";

/**
 * A take, the same scenario through both Recorders. Each reaches the clip
 * reducer through its reducer's effects, as its hook sends them: OBS's
 * connector (`obsConnectorReducer`, `useOBSConnector`) and its polling, the
 * CVM recorder's adapter (`cvmRecorderReducer`, `use-cvm-recorder.ts`).
 * Both save through a model of the app server: each save is placed where
 * the editor says with it (OBS's poll, the CVM recorder's `place-take`),
 * and the database's order must end up the editor's.
 */

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
  /** The app server carries out what the editor asked of it. */
  const serve = () => {
    const effects = clips.getEffects();
    for (const effect of effects.slice(effectsSeen)) {
      if (effect.type === "archive-clips" || effect.type === "unarchive-clips")
        for (const row of rows)
          if (effect.clipIds.includes(row.id as DatabaseId))
            row.archived = effect.type === "archive-clips";
    }
    effectsSeen = effects.length;
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
  /** The insertion point the editor sends with a save, as OBS's poll does. */
  const editorPoint = () =>
    resolveInsertionPoint(
      clips.getState().insertionPoint,
      clips.getState().items
    );
  return {
    clips,
    send,
    save,
    editorPoint,
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
    saveTake: (clipId: string) => void;
    /** Recording stops, and the OBS path's session timeout runs out. */
    stopRecording: () => void;
    /** The editor loses the Recorder and finds it again: OBS's websocket, the app server's events. */
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

/** The edit route's `onClipAudioWindowClosed`, either Recorder's. */
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

const MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";
const CALIBRATED_AT = Date.UTC(2026, 9, 12, 9);
const calibration: LastPassedCalibration = {
  id: "calibration-1",
  createdAtMs: CALIBRATED_AT,
  thresholdDb: -43,
  recorderMic: MIC,
  browserInputLabel: MIC,
  cameraDevice: "Cam Link 4K",
};
const gateFacts = (nowMs: number) => ({
  lastPassed: calibration,
  browserInputLabel: MIC,
  nowMs,
});

const obsFile = (n: number) => `/obs/take-${n}.mkv`;

/**
 * OBS: websocket events and the mic's silence scan into its connector,
 * whose effects reach the clip reducer as `useOBSConnector` sends them.
 */
export const obs: Recorder = {
  name: "OBS",
  connect: (e, opts) => {
    const connector = new ReducerTester(
      obsConnectorReducer,
      createInitialOBSConnectorState(true, () => {})
    );
    let file = obsFile(1);
    let clock = 0;
    let sound = 0;
    let effectsSeen = 0;

    const report = (action: obsConnectorReducer.Action) => {
      const before = connector.getState().obs.type;
      connector.send(action);
      const effects = connector.getEffects();
      for (const effect of effects.slice(effectsSeen)) {
        if (effect.type === "start-session") {
          const { type: _, ...session } = effect;
          e.send({ type: "recording-started", ...session });
        } else if (effect.type === "stop-session")
          e.send({ type: "recording-stopped" });
        else if (effect.type === "start-take") {
          const { type: _, ...take } = effect;
          e.send({ type: "new-optimistic-clip-detected", ...take });
        } else if (effect.type === "close-take-window") closeTakeWindow(e);
      }
      effectsSeen = effects.length;
      // `useSpeechDetector` restarts the detector as OBS starts recording.
      const after = connector.getState().obs.type;
      if (before !== "obs-recording" && after === "obs-recording")
        hear({ type: "recording-started" });
    };
    const hear = (heard: speechDetectorReducer.Action) =>
      report({ type: "speech-heard", heard });
    const endSpeech = () => {
      clock += 1;
      hear({ type: "silence-started" });
    };
    const connected = (recording: boolean) =>
      report({
        type: "obs-connected",
        profile: "Landscape",
        scene: "Camera",
        recording,
      });

    // The page opens and OBS connects. A take going on is stopped.
    connected(opts?.midTake ?? false);
    if (opts?.midTake) report({ type: "recording-stopped", outputPath: file });

    const speak = () => {
      clock += 1;
      hear({ type: "silence-ended", endSeconds: clock });
    };
    const holdSpeech = () => {
      clock += MINIMUM_CLIP_LENGTH_SECONDS + 0.1;
      hear({
        type: "audio-heard",
        atSeconds: clock,
        soundDetectionId: `sound-${++sound}`,
      });
    };
    return {
      startRecording: (n = 1) => {
        file = obsFile(n);
        report({
          type: "recording-started",
          outputPath: file,
          silenceLength: "short",
          ...gateFacts(CALIBRATED_AT + 60_000),
        });
        endSpeech();
      },
      refusedRecord: () => {
        report({
          type: "recording-started",
          outputPath: file,
          silenceLength: "short",
          ...gateFacts(CALIBRATED_AT + CALIBRATION_VALIDITY_MS),
        });
        report({ type: "recording-stopped", outputPath: file });
      },
      speak,
      holdSpeech,
      startTake: () => {
        speak();
        holdSpeech();
      },
      endSpeech,
      saveTake: (clipId) => {
        endSpeech();
        // The next poll finds the Clip in the file, saved where it says.
        e.send({
          type: "new-database-clips",
          clips: [e.save(clipId, e.editorPoint())],
          outputPath: file,
          transcriptionJobId: `job-${clipId}`,
        });
      },
      stopRecording: () => {
        report({ type: "recording-stopped", outputPath: file });
        timeOut(e);
      },
      reconnect: () => {
        report({ type: "connection-closed" });
        connected(connector.getState().interrupted !== null);
      },
      speech: () => toFrontendSpeechDetectorState(connector.getState().speech),
      stops: () =>
        connector.getEffects().filter((x) => x.type === "stop-recording")
          .length,
    };
  },
};

export const recordingSession = (n: number) => `session-${n}`;

/**
 * The CVM recorder: messages into its adapter, whose effects reach the clip
 * reducer as `use-cvm-recorder.ts` sends them. `place-take` asks the app
 * server to save the speech where the editor says, and answers with the
 * Clip; the `nextClipId` is the Clip that speech makes, if any.
 */
export const cvmAdapter = (e: Editor) => {
  const recorder = new ReducerTester(
    cvmRecorderReducer,
    createInitialCvmRecorderState()
  );
  let effectsSeen = 0;
  const pending: string[] = [];
  const run = () => {
    const effects = recorder.getEffects();
    for (const effect of effects.slice(effectsSeen)) {
      effectsSeen += 1;
      switch (effect.type) {
        case "start-session":
          e.send({
            type: "recording-started",
            outputPath: effect.recordingSessionId,
            recordingSessionId: effect.recordingSessionId,
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
        case "place-take": {
          const clipId = pending.shift();
          if (clipId)
            e.send({
              type: "new-database-clips",
              clips: [e.save(clipId, e.editorPoint())],
              outputPath: effect.recordingSessionId,
              transcriptionJobId: `job-${clipId}`,
            });
          break;
        }
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
      saveTake: (clipId) => {
        adapter.willSave(clipId);
        endSpeech();
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
