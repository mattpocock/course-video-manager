import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
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
  canStop,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import type {
  CvmRecorderMessage,
  SavedRecorderClip,
} from "./cvm-recorder-wire";

/**
 * A take, the same scenario through both Recorders. OBS drives the clip
 * reducer with its own events (the connector, the speech detector, its
 * polling); the CVM recorder only through its adapter (`cvmRecorderReducer`),
 * whose effects reach the clip reducer as `use-cvm-recorder.ts` sends them.
 * Both save through a model of the app server: each save is placed where
 * the editor says with it (OBS's poll, the CVM recorder's `place-take`),
 * and the database's order must end up the editor's.
 */

type ClipTester = ReducerTester<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
>;

const dbClip = (id: string) =>
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
const editor = (items: string[]) => {
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
type Editor = ReturnType<typeof editor>;

type Recorder = {
  name: string;
  connect: (e: Editor) => {
    /** Recording Session `n` (1 by default) starts. */
    startRecording: (n?: number) => void;
    /** Speech long enough for a Clip. */
    startTake: () => void;
    /** The speech ends, and its Clip is saved where the editor says. */
    saveTake: (clipId: string) => void;
    /** Recording stops, and the OBS path's session timeout runs out. */
    stopRecording: () => void;
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

const obsFile = (n: number) => `/obs/take-${n}.mkv`;
const obs: Recorder = {
  name: "OBS",
  connect: (e) => {
    let file = obsFile(1);
    let sound = 0;
    return {
      startRecording: (n = 1) => {
        file = obsFile(n);
        e.send({
          type: "recording-started",
          outputPath: file,
          silenceLength: "short",
        });
      },
      startTake: () =>
        e.send({
          type: "new-optimistic-clip-detected",
          soundDetectionId: `sound-${++sound}`,
          scene: "Camera",
          profile: "Landscape",
        }),
      saveTake: (clipId) => {
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
        // The next poll finds the Clip in the file, saved where it says.
        e.send({
          type: "new-database-clips",
          clips: [e.save(clipId, e.editorPoint())],
          outputPath: file,
          transcriptionJobId: `job-${clipId}`,
        });
      },
      stopRecording: () => {
        e.send({ type: "recording-stopped" });
        timeOut(e);
      },
    };
  },
};

const recordingSession = (n: number) => `session-${n}`;

/**
 * The CVM recorder: messages into its adapter, whose effects reach the clip
 * reducer as `use-cvm-recorder.ts` sends them. `place-take` asks the app
 * server to save the speech where the editor says, and answers with the
 * Clip; the `nextClipId` is the Clip that speech makes, if any.
 */
const cvmAdapter = (e: Editor) => {
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
        case "close-take-window": {
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
          break;
        }
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
  return {
    recorder,
    hear: heard,
    /** Speech the recorder service calls a Take: `speech-started`, then `take-started`. */
    take: (recordingSessionId: string) => {
      heard({ type: "speech-started", recordingSessionId });
      heard({
        type: "take-started",
        recordingSessionId,
        takeId: `${recordingSessionId}:${++takes}`,
        startTime: 0,
      });
    },
    /** The next speech that ends makes this Clip. */
    willSave: (clipId: string) => pending.push(clipId),
  };
};

const status = (recordingSessionId: string | null): CvmRecorderMessage => ({
  type: "recorder-status",
  reachable: true,
  problem: null,
  recordingSessionId,
  previews: { camera: "c", screen: "s" },
  still: "still",
});

const stopped = (id: string): CvmRecorderMessage => ({
  type: "recording-stopped",
  recordingSessionId: id,
  errors: [],
  crashed: false,
  framesLost: { camera: 0, screen: 0 },
  lostFrameSpans: [],
});

const cvm: Recorder = {
  name: "CVM recorder",
  connect: (e) => {
    const adapter = cvmAdapter(e);
    let id = recordingSession(1);
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
      startTake: () => adapter.take(id),
      saveTake: (clipId) => {
        adapter.willSave(clipId);
        adapter.hear({ type: "speech-ended", recordingSessionId: id });
      },
      stopRecording: () => {
        // The app server says it stopped before the stop event lands.
        adapter.hear(status(null));
        adapter.hear(stopped(id));
        timeOut(e);
      },
    };
  },
};

const shown = (e: Editor) =>
  e.clips
    .getState()
    .items.filter((i) => !("shouldArchive" in i && i.shouldArchive))
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

const archived = (e: Editor) =>
  e.clips
    .getState()
    .items.filter((i) => "shouldArchive" in i && i.shouldArchive)
    .map((i) => (i.type === "on-database" ? i.databaseId : i.type));

const frontendIdOf = (e: Editor, id: string) =>
  e.clips
    .getState()
    .items.find((i) => i.type === "on-database" && i.databaseId === id)!
    .frontendId;

describe.each([obs, cvm])("a take on the $name", (recorder) => {
  it("shows the take as an Optimistic Clip at the insertion point, filled in where it stands and saved there", () => {
    const e = editor(["a", "b"]);
    const r = recorder.connect(e);
    e.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    r.startRecording();

    r.startTake();
    expect(shown(e)).toEqual(["a", "optimistically-added", "b"]);

    r.saveTake("c1");
    expect(shown(e)).toEqual(["a", "c1", "b"]);
    expect(e.database()).toEqual(["a", "c1", "b"]);
    expect(e.clips.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: frontendIdOf(e, "c1"),
    });
  });

  it("Stream Deck delete during a take archives that take, not the Clip before it, and keeps its Footage", () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();

    e.send({ type: "delete-latest-inserted-clip" });
    expect(shown(e)).toEqual(["a"]);
    expect(e.clips.getEffects().map((x) => x.type)).not.toContain(
      "archive-clips"
    );

    // The take is saved anyway, and arrives archived: never deleted.
    r.saveTake("c1");
    expect(shown(e)).toEqual(["a"]);
    expect(archived(e)).toEqual(["c1"]);
    expect(e.database()).toEqual(["a"]);
  });

  it("restores a take deleted mid-take in place, and the next take lands at the insertion point", () => {
    const e = editor(["a", "b"]);
    const r = recorder.connect(e);
    e.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    r.startRecording();

    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });
    r.saveTake("c1");

    r.startTake();
    r.saveTake("c2");
    expect(shown(e)).toEqual(["a", "c2", "b"]);
    expect(e.database()).toEqual(["a", "c2", "b"]);

    e.send({ type: "restore-clip", clipId: frontendIdOf(e, "c1") });
    expect(e.clips.getEffects().at(-1)).toEqual({
      type: "unarchive-clips",
      clipIds: ["c1"],
    });
    expect(shown(e)).toEqual(e.database());
  });

  it("restoring a take before it is saved means it is saved live", () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });

    const take = e.clips.getState().items[1]!;
    e.send({ type: "restore-clip", clipId: take.frontendId });
    r.saveTake("c1");

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
    expect(e.clips.getEffects().map((x) => x.type)).not.toContain(
      "archive-clips"
    );
  });

  // #2163: a Clip deleted mid-take, then more speech, a Stop and a new take.
  it("after a take deleted mid-take, every later take saves where the editor shows it, through Stop and the next Recording Session", () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });
    r.saveTake("c1");
    expect(archived(e)).toEqual(["c1"]);

    r.startTake();
    r.saveTake("c2");
    r.startTake();
    r.saveTake("c3");
    expect(shown(e)).toEqual(["a", "c2", "c3"]);

    r.stopRecording();
    expect(e.clips.getState().sessions.map((s) => s.status)).toEqual(["done"]);

    r.startRecording(2);
    r.startTake();
    r.saveTake("c4");
    expect(shown(e)).toEqual(["a", "c2", "c3", "c4"]);
    expect(e.database()).toEqual(["a", "c2", "c3", "c4"]);
    expect(archived(e)).toEqual(["c1"]);
  });

  it("a saved take deleted straight after, then more speech, saves the next take where the editor shows it", () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    r.saveTake("c1");
    e.send({ type: "delete-latest-inserted-clip" });
    expect(archived(e)).toEqual(["c1"]);

    r.startTake();
    r.saveTake("c2");
    expect(shown(e)).toEqual(["a", "c2"]);
    expect(e.database()).toEqual(["a", "c2"]);
  });

  it("a take whose speech made no Clip is orphaned once the recording stops", () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    r.stopRecording();

    expect(e.clips.getState().items[1]).toMatchObject({
      type: "optimistically-added",
      isOrphaned: true,
    });
    expect(e.database()).toEqual(["a"]);
  });
});

describe("the CVM recorder's adapter", () => {
  const SESSION = recordingSession(1);

  it("saves the last take of a Recording Session in its place when the app server says it stopped first", () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    // Opened idle; then a Stream Deck Record.
    adapter.hear(status(null));
    adapter.hear(status(SESSION));
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    expect(adapter.recorder.getState().phase).toBe("recording");

    adapter.hear(status(null));
    adapter.willSave("c1");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear(stopped(SESSION));

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
    expect(adapter.recorder.getState().phase).toBe("idle");
  });

  it("shows no Optimistic Clip for an 'um' the recorder never called a Take, and the next take fills its own", () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: SESSION,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    // The um: speech, then silence, and no take-started.
    adapter.hear({ type: "speech-started", recordingSessionId: SESSION });
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    expect(e.clips.getState().items.map((i) => i.type)).toEqual([
      "on-database",
    ]);
    expect(
      adapter.recorder.getEffects().filter((x) => x.type === "place-take")
    ).toEqual([]);

    adapter.take(SESSION);
    expect(e.clips.getState().items.map((i) => i.type)).toEqual([
      "on-database",
      "optimistically-added",
    ]);
    adapter.willSave("c1");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
  });

  it("shows Clips the app server saved without the editor in their take", () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: SESSION,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    // The editor's answer never arrived: saved after the Video's last item.
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear({
      type: "clips-saved",
      recordingSessionId: SESSION,
      clips: [e.save("c1", { type: "after-clip", databaseClipId: "a" })],
      transcriptionJobId: "job-c1",
    });

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.clips.getEffects()).toContainEqual({
      type: "transcribe-clips",
      jobId: "job-c1",
      clipIds: ["c1"],
    });
  });

  it("leaves an old Recording Session's late events alone: the current take is untouched (#2163)", () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(SESSION));
    adapter.hear(stopped(SESSION));
    const old = recordingSession(1);
    const current = recordingSession(2);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: current,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: current });
    adapter.take(current);
    const take = e.clips.getState().items.at(-1)!;
    const before = e.clips.getEffects().length;

    adapter.willSave("never");
    adapter.take(old);
    adapter.hear({ type: "speech-ended", recordingSessionId: old });
    adapter.hear({
      type: "clips-saved",
      recordingSessionId: old,
      clips: [dbClip("late")],
      transcriptionJobId: "job-late",
    });
    adapter.hear(stopped(old));

    expect(e.clips.getEffects().length).toBe(before);
    expect(e.clips.getState().items.at(-1)).toEqual(take);
    expect(adapter.recorder.getState()).toMatchObject({
      phase: "recording",
      recordingSessionId: current,
    });
  });

  // #2182: a refresh mid-take stops it, as OBS's connector does on connect.
  it("stops a Recording Session already going when it loads, and still places its last take", () => {
    const e = editor(["a", "b"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(SESSION));
    const stops = () =>
      adapter.recorder.getEffects().filter((x) => x.type === "stop-recording")
        .length;
    expect(stops()).toBe(1);
    expect(adapter.recorder.getState().phase).toBe("stopping");
    expect(e.clips.getState().sessions).toMatchObject([
      { status: "recording", outputPath: SESSION },
    ]);
    // A reconnect's status stops nothing more and starts nothing new.
    adapter.hear(status(SESSION));
    expect(stops()).toBe(1);
    expect(e.clips.getState().sessions).toHaveLength(1);

    // The speech heard before the stop landed is saved where the editor says.
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    adapter.willSave("c");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear(status(null));
    adapter.hear(stopped(SESSION));

    expect(shown(e)).toEqual(["a", "b", "c"]);
    expect(e.database()).toEqual(["a", "b", "c"]);
    expect(adapter.recorder.getState().phase).toBe("idle");
  });

  it("does not stop a Recording Session that starts after it loads, through a reconnect", () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(null));
    adapter.hear(status(SESSION));
    adapter.hear(status(SESSION));
    expect(
      adapter.recorder.getEffects().some((x) => x.type === "stop-recording")
    ).toBe(false);
    expect(canStop(adapter.recorder.getState())).toBe(true);
  });
});
