import { WebSocket } from "ws";
import {
  type RecorderCommand,
  type RecorderMessage,
  type RecorderState,
} from "recorder-service/protocol";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import type { SilenceLength } from "@/silence-detection-constants";
import type { LastPassedCalibration } from "@/av-calibration-constants";
import type { Scene } from "@/packages/scene-layout";
import type { VideoFormat } from "@/features/videos/video-format";
import {
  cameraMessage,
  sceneMessage,
  screenMessage,
  serviceUrls,
} from "./editor-messages";
import { helloProblem } from "./service-version";
import type { AskEditor, IngestResult } from "./ingest.server";
import { createTakePlacer, type EditorLeft } from "./take-placer";
import { RecorderRefusedError, NOT_RUNNING } from "./recorder-command";
import { commandWaiters } from "./command-waiters";
import {
  createServiceOnDemand,
  RECORDER_IDLE_MS,
  type RecorderServiceLauncher,
} from "./service-on-demand";
import { createRecorderEventSequencer, type SequencedEvent } from "./sequencer";
import { meterRelay, isMeterMessage } from "./meter-relay";
import { calibrationCommands } from "./calibration-commands";
import { streamDeckPreparation } from "./stream-deck-prepare";
import { watchRecorder } from "./recorder-watch";

/**
 * THE RECORDER CLIENT: the app server's one WebSocket to the recorder service
 * (ADR 0034, 0035). It sends Record and Stop for the editor, saves what the
 * recorder's events mean (`ingest.server.ts`) one at a time and in order,
 * and passes what was saved on to the editors open on that Video.
 *
 * It holds no insertion point: each speech is saved where an editor says
 * (`take-placer.ts`).
 *
 * An event it could not save is not lost: the rest of that Recording Session
 * waits, and after a pause the whole of it is asked for again (saving is
 * idempotent, so what was saved stays saved), the pause doubling each time,
 * until `MAX_SAVE_RETRIES`; the next greeting from the recorder service tries
 * again after that.
 *
 * Something listening (an editor, or an AV Calibration page's meter) is
 * also what starts the recorder service, when the client has a `launcher`
 * (`service-on-demand.ts`, ADR 0053), and its going what lets it idle out.
 *
 * An editor listening is what keeps the recorder open: the first editor on a
 * CVM recorder Video opens the recorder for it (which opens the Cam Link and
 * the previews), and once the last editor has gone, for longer than a page
 * reload takes, the recorder closes and lets the camera go. Several Videos
 * listening: the one most recently opened has it. A recording is never
 * closed this way; it closes once stopped, if nobody listens by then.
 *
 * The Stream Deck presses Record, Stop and the scenes on the recorder
 * service itself; this client tells the service what a Stream Deck Record on
 * the open Video records with (`stream-deck-prepare.ts`), and hears its
 * events as for any Record. Every Record carries its AV Calibration.
 */

/** How many times one event that will not save is asked for again. */
export const MAX_SAVE_RETRIES = 5;

export type RecorderClientOptions = {
  url: string;
  /** Saves one event; the client runs one at a time. */
  ingest: (
    event: SequencedEvent,
    askEditor: AskEditor
  ) => Promise<IngestResult>;
  /** How long a save waits for an editor to say where (`placeTake`). */
  placeTimeoutMs: number;
  /**
   * The Recording Sessions the database still has as recording, and those of
   * `candidates` it has no row for. Each is replayed whenever the recorder
   * service greets the client, so a start, stop or crash it missed (the app
   * server was down) is caught up on.
   */
  unfinishedRecordingSessions: (candidates: string[]) => Promise<string[]>;
  /** How long to wait before reconnecting to a recorder service that went away. */
  reconnectMs: number;
  /** How long a command may take to be carried out. */
  commandTimeoutMs: number;
  /** How long the recorder stays open after its last editor goes (a reload). */
  closeGraceMs: number;
  /** The pause before a Recording Session with an unsaved event is asked for again. */
  retryMs: number;
  /** The folder (WSL path) a Stream Deck Record's Recording Session goes in. */
  folder: string;
  /** What a Record goes by (ADR 0038): `lastPassedCalibration`. */
  calibration: () => Promise<LastPassedCalibration | null>;
  /** `whisper-warmth.ts` */
  keepWhisperWarm?: (ms: number) => void;
  /** Starts the service on demand. Absent: it is someone else's (a test's, or none). */
  launcher?: RecorderServiceLauncher;
  /** How long it stays up unneeded: `RECORDER_IDLE_MS`. */
  idleMs?: number;
};

type Listener = (message: CvmRecorderMessage) => void;

export const createRecorderClient = (o: RecorderClientOptions) => {
  const listeners = new Map<string, Set<Listener>>();
  const sequencer = createRecorderEventSequencer();
  let socket: WebSocket | undefined;
  let reachable = false;
  let problem: string | null = null;
  let state: RecorderState = { kind: "closed" };
  let closed = false;
  let ingesting: Promise<void> = Promise.resolve();
  /** Events heard and not yet saved (or failed): the service waits for them. */
  let saving = 0;
  /** Videos with editors listening, the most recently opened last. */
  let wanted: string[] = [];
  /** The Video last asked to be open (null: asked to close), until it is. */
  let asked: string | null | undefined;
  /** Per Video: the format it opens the recorder in (its editor's or Record's). */
  const formats = new Map<string, VideoFormat>();
  const lastCamera = new Map<string, string>();
  /** Per Video and kind (scene, screen): the last sent while the recorder is its. */
  const lastOpen = new Map<string, string>();
  const { previews, still } = serviceUrls(o.url);

  const watch = watchRecorder(o.keepWhisperWarm, () =>
    reachable ? state.kind : "closed"
  );

  const publish = (videoId: string, message: CvmRecorderMessage) => {
    for (const listener of listeners.get(videoId) ?? []) listener(message);
  };
  const placer = createTakePlacer({ timeoutMs: o.placeTimeoutMs, publish });
  const statusFor = (videoId: string): CvmRecorderMessage => ({
    type: "recorder-status",
    reachable,
    problem,
    starting: !reachable && (onDemand?.launched() ?? false),
    recordingSessionId:
      state.kind === "recording" && state.videoId === videoId
        ? state.recordingSessionId
        : null,
    previews,
    still,
  });
  /** The camera's state, to an editor, only when it changed. */
  const publishCamera = (videoId: string) => {
    const message = reachable
      ? cameraMessage(state, videoId)
      : ({ type: "camera-closed" } as const);
    if (!message) return;
    const key = JSON.stringify(message);
    if (lastCamera.get(videoId) === key) return;
    lastCamera.set(videoId, key);
    publish(videoId, message);
  };
  /**
   * The scene or a Short's screen, to an editor, only when it changed. Once
   * the recorder is not its Video's (closed, another Video's, unreachable)
   * its editor has neither, so it hears them again when the recorder is back.
   */
  const publishWhileOpen = (
    videoId: string,
    message: CvmRecorderMessage | undefined,
    kind: "scene" | "screen",
    listener?: Listener
  ) => {
    const key = `${videoId}:${kind}`;
    if (!reachable || !message) return void lastOpen.delete(key);
    const json = JSON.stringify(message);
    if (lastOpen.get(key) === json && !listener) return;
    lastOpen.set(key, json);
    if (listener) listener(message);
    else publish(videoId, message);
  };
  const publishStatus = () => {
    for (const videoId of listeners.keys()) {
      publish(videoId, statusFor(videoId));
      publishCamera(videoId);
      publishWhileOpen(videoId, sceneMessage(state, videoId), "scene");
      publishWhileOpen(videoId, screenMessage(state, videoId), "screen");
    }
  };

  const send = (command: RecorderCommand) => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(command));
  };
  const waiters = commandWaiters({
    send,
    connected: () => reachable && socket?.readyState === WebSocket.OPEN,
    timeoutMs: o.commandTimeoutMs,
  });
  const command = waiters.command;

  const onDemand =
    o.launcher &&
    createServiceOnDemand({
      launcher: o.launcher,
      idleMs: o.idleMs ?? RECORDER_IDLE_MS,
      busy: () => (reachable && state.kind === "recording") || saving > 0,
      changed: () => publishStatus(),
    });
  /** After a listener comes or goes. */
  const demandChanged = () =>
    listeners.size + meter.listening() > 0
      ? onDemand?.need()
      : onDemand?.release();
  const meter = meterRelay({
    send,
    unavailable: () => (reachable ? problem : NOT_RUNNING),
    changed: () => demandChanged(),
  });

  const deck = streamDeckPreparation({
    send,
    calibration: o.calibration,
    folder: o.folder,
  });
  /** Tells the open recorder what a Stream Deck Record on its Video records with. */
  const prepare = () =>
    deck.prepare(
      reachable && state.kind !== "closed" ? state.videoId : undefined
    );

  /** Opens the recorder for the Video an editor wants, or closes it for none. */
  const reconcile = () => {
    if (!reachable || problem || state.kind === "recording") return;
    const want = wanted.at(-1) ?? null;
    const format = want ? (formats.get(want) ?? "landscape") : undefined;
    const settled = want
      ? state.kind === "open" &&
        state.videoId === want &&
        state.format === format
      : state.kind === "closed";
    if (settled) {
      asked = undefined;
      return;
    }
    const ask = want && `${want}:${format}`;
    if (asked === ask) return;
    asked = ask;
    send(want ? { type: "open", videoId: want, format } : { type: "close" });
  };

  /**
   * Per Recording Session: bumped when one of its events fails to save, so
   * the events queued behind it wait for the replay instead of saving out of
   * order.
   */
  const generations = new Map<string, number>();
  /** Per Recording Session: the event that will not save, and its tries. */
  const failing = new Map<string, { seq: number; tries: number }>();

  const saveFailed = (event: SequencedEvent, error: unknown) => {
    const id = event.recordingSessionId;
    console.error(`recorder client: could not save ${event.type}`, error);
    const message = `Could not save the recorder's ${event.type}: ${error instanceof Error ? error.message : String(error)}`;
    for (const videoId of listeners.keys())
      publish(videoId, { type: "recorder-failed", message });

    generations.set(id, (generations.get(id) ?? 0) + 1);
    sequencer.forget(id);
    const before = failing.get(id);
    const tries = before?.seq === event.seq ? before.tries + 1 : 1;
    failing.set(id, { seq: event.seq, tries });
    if (tries > MAX_SAVE_RETRIES) return;
    setTimeout(
      () => send({ type: "replay", recordingSessionId: id, afterSeq: 0 }),
      o.retryMs * 2 ** (tries - 1)
    );
  };

  const ingest = (event: SequencedEvent) => {
    const id = event.recordingSessionId;
    const generation = generations.get(id) ?? 0;
    saving++;
    const saved = ingesting.then(async () => {
      if ((generations.get(id) ?? 0) !== generation) return;
      const { askEditor, settle } = placer.forEvent(event);
      let result: IngestResult;
      try {
        result = await o.ingest(event, askEditor);
      } catch (error) {
        settle();
        saveFailed(event, error);
        return;
      }
      settle(result.placed);
      if ((failing.get(id)?.seq ?? Infinity) <= event.seq) failing.delete(id);
      if (!result.videoId) return;
      // Refused (a Stream Deck Record outside the Draft): a take that is
      // never saved does not run on.
      if (
        result.refused &&
        state.kind === "recording" &&
        state.recordingSessionId === id
      )
        send({ type: "stop" });
      for (const message of result.messages) publish(result.videoId, message);
    });
    ingesting = saved.finally(() => void saving--);
  };

  /**
   * Replays every Recording Session that may have events this client never
   * saved: the one recording now, the ones the service found crashed, the
   * ones the database still has as recording, and the service's recent ones
   * the database never heard of (filmed from the Stream Deck while the app
   * server was down). Each replays from after
   * the last event this client heard of it: after a dropped connection, only
   * what it missed; after an app-server restart, the whole of it, and what
   * was saved already is skipped (ingest is idempotent).
   */
  const catchUp = (recovered: string[], recent: string[]) => {
    const ids = new Set(recovered);
    if (state.kind === "recording") ids.add(state.recordingSessionId);
    void o
      .unfinishedRecordingSessions(recent)
      .catch((error: unknown) => {
        console.error(
          "recorder client: could not read unfinished Recording Sessions",
          error
        );
        return [];
      })
      .then((unfinished) => {
        for (const id of unfinished) ids.add(id);
        for (const recordingSessionId of ids)
          send({
            type: "replay",
            recordingSessionId,
            afterSeq: sequencer.heard(recordingSessionId),
          });
      });
  };

  const onMessage = (message: RecorderMessage) => {
    waiters.hear(message);
    if (isMeterMessage(message)) return meter.hear(message);
    switch (message.type) {
      case "hello":
        reachable = true;
        problem = helloProblem(message);
        state = message.state;
        asked = undefined;
        deck.forget();
        reconcile();
        prepare();
        watch.changed();
        catchUp(message.recovered, message.recent);
        meter.restart();
        return publishStatus();
      case "state": {
        const letGo =
          state.kind === "recording" && message.state.kind !== "recording";
        state = message.state;
        reconcile();
        prepare();
        watch.changed();
        // Stop lets a take go at the press (ADR 0048): the editors hear the
        // take's events so far, still being saved, before they hear it is over.
        if (letGo) return void (ingesting = ingesting.then(publishStatus));
        return publishStatus();
      }
      case "stream-deck-ignored":
        for (const videoId of listeners.keys())
          publish(videoId, {
            type: "recorder-failed",
            message: `Stream Deck: ${message.message}`,
          });
        return;
      case "refused":
        meter.hear(message);
        // An open or close of our own was refused: ask again on the next state.
        if (message.command === "open" || message.command === "close") {
          asked = undefined;
          const videoId = wanted.at(-1);
          if (message.command === "open" && videoId)
            publish(videoId, {
              type: "recorder-failed",
              message: message.message,
            });
        }
        return;
      case "replay-done":
        return;
      case "recording-started":
      case "scene-changed":
      case "screen-recorder-tuned":
      case "warmed-up":
      case "speech-started":
      case "take-started":
      case "speech-ended":
      case "camera-lost":
      case "frames-lost":
      case "recording-stopped":
      case "recording-crashed": {
        const { ready, replay } = sequencer.accept(message);
        if (replay) send({ type: "replay", ...replay });
        for (const event of ready) ingest(event);
        return;
      }
    }
  };

  const connect = () => {
    if (closed) return;
    const ws = new WebSocket(o.url);
    socket = ws;
    ws.on("message", (data) => {
      onMessage(JSON.parse(String(data)) as RecorderMessage);
    });
    ws.on("error", () => {
      // `close` follows; nothing answering is the usual case.
    });
    ws.on("close", () => {
      if (socket !== ws) return;
      socket = undefined;
      asked = undefined;
      deck.forget();
      if (reachable) {
        reachable = false;
        watch.changed();
        publishStatus();
        meter.restart();
      }
      waiters.wentAway();
      if (!closed) setTimeout(connect, o.reconnectMs);
    });
  };
  connect();

  const isState = (
    message: RecorderMessage,
    kind: RecorderState["kind"],
    videoId: string,
    format?: VideoFormat
  ) =>
    message.type === "state" &&
    message.state.kind === kind &&
    message.state.kind !== "closed" &&
    message.state.videoId === videoId &&
    (!format || message.state.format === format);

  const requireOpenFor = (videoId: string) => {
    if (state.kind === "closed" || state.videoId !== videoId)
      throw new RecorderRefusedError(
        "The recorder is not open for this Video."
      );
  };

  return {
    /** Hear what happens to a Video's Recording Sessions; starts with the status. */
    subscribe(
      videoId: string,
      listener: Listener,
      format: VideoFormat = "landscape"
    ) {
      formats.set(videoId, format);
      let set = listeners.get(videoId);
      if (!set) listeners.set(videoId, (set = new Set()));
      set.add(listener);
      listener(statusFor(videoId));
      const camera = reachable ? cameraMessage(state, videoId) : undefined;
      if (camera) {
        lastCamera.set(videoId, JSON.stringify(camera));
        listener(camera);
      }
      publishWhileOpen(
        videoId,
        sceneMessage(state, videoId),
        "scene",
        listener
      );
      publishWhileOpen(
        videoId,
        screenMessage(state, videoId),
        "screen",
        listener
      );
      wanted = [...wanted.filter((v) => v !== videoId), videoId];
      reconcile();
      demandChanged();
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(videoId);
        demandChanged();
        lastCamera.delete(videoId);
        lastOpen.delete(`${videoId}:scene`);
        lastOpen.delete(`${videoId}:screen`);
        setTimeout(() => {
          if (listeners.has(videoId)) return;
          wanted = wanted.filter((v) => v !== videoId);
          reconcile();
        }, o.closeGraceMs);
      };
    },

    async startRecording(
      videoId: string,
      request: {
        silenceLength: SilenceLength;
        /** The folder (WSL path) each Recording Session's folder goes in. */
        folder: string;
        /** The Video's format: a Short records the Short layout's sources. */
        format?: VideoFormat;
      }
    ) {
      if (problem) throw new RecorderRefusedError(problem);
      const format = request.format ?? "landscape";
      formats.set(videoId, format);
      await command({ type: "open", videoId, format }, (m) =>
        isState(m, "open", videoId, format)
      );
      await command(
        {
          type: "record",
          silenceLength: request.silenceLength,
          folder: request.folder,
          calibration: await o.calibration(),
        },
        (m) => isState(m, "recording", videoId)
      );
    },

    /** Tries the Cam Link again, after it did not start or was busy. */
    async retryCamera(videoId: string) {
      if (state.kind !== "open" || state.videoId !== videoId)
        throw new RecorderRefusedError(
          "The recorder is not open for this Video."
        );
      await command(
        { type: "retry-camera" },
        (m) =>
          m.type === "state" &&
          m.state.kind === "open" &&
          m.state.camera.kind === "opening"
      );
    },

    /** A Short's screen: wakes Spacedesk and looks for its display again. */
    async retryScreen(videoId: string) {
      requireOpenFor(videoId);
      await command(
        { type: "retry-screen" },
        (m) =>
          m.type === "state" &&
          m.state.kind === "open" &&
          m.state.screen?.kind === "waking"
      );
    },

    /** Draws the picture in `scene` from now on, recording or not. */
    async switchScene(videoId: string, scene: Scene) {
      requireOpenFor(videoId);
      await command(
        { type: "switch-scene", scene },
        (m) =>
          m.type === "state" &&
          m.state.kind !== "closed" &&
          m.state.videoId === videoId &&
          m.state.scene === scene
      );
    },

    /** Stop. `editorLeft`: only its Recording Session (`take-placer.ts`). */
    async stopRecording(videoId: string, editorLeft?: EditorLeft) {
      if (editorLeft) {
        placer.editorLeft(videoId, editorLeft);
        if (
          state.kind !== "recording" ||
          state.recordingSessionId !== editorLeft.recordingSessionId
        )
          return;
      }
      if (state.kind !== "recording" || state.videoId !== videoId)
        throw new RecorderRefusedError("This Video is not recording.");
      await command({ type: "stop" }, (m) => isState(m, "open", videoId));
    },

    /** An AV Calibration was stored: the next Stream Deck Record cuts with it. */
    calibrationChanged() {
      deck.forget();
      prepare();
    },

    /** The editor's Silence Length: what a Stream Deck Record on this Video uses. */
    setSilenceLength(videoId: string, silenceLength: SilenceLength) {
      deck.setSilenceLength(videoId, silenceLength);
      prepare();
    },

    ...watch.signal,

    placeTake: placer.placeTake,

    subscribeMeter: meter.subscribe,

    ...calibrationCommands({ command, problem: () => problem }),

    /** Waits for every event heard so far to be saved (tests). */
    settled: () => ingesting,

    close() {
      closed = true;
      watch.close();
      onDemand?.close();
      socket?.close();
    },
  };
};

export type RecorderClient = ReturnType<typeof createRecorderClient>;
