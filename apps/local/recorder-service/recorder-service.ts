import { Either } from "effect";
import { decodeCommand, refusalOfUndecodable } from "./command-schema";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { corsHeaders, isAllowedOrigin } from "./allowed-origin";
import { recoverCrashedSessions } from "./crash-recovery";
import { CAMERA_START_TIMEOUT_MS, openCamera, type Camera } from "./camera";
import type { Launcher } from "./launcher";
import { resolveToggle } from "./stream-deck-press";
import { DEFAULT_SCENE, type Scene } from "../app/packages/scene-layout";
import { startPreviewFeeds } from "./preview-feeds";
import { serveStill } from "./still";
import { createMeterSide } from "./level-meter";
import {
  CALIBRATION_WHILE_RECORDING,
  METER_WHILE_RECORDING,
  RECORD_WHILE_METERING,
  STILL_PATH,
  RECORDER_PROTOCOL_VERSION,
  type CameraStatus,
  type RecorderCommand,
  type RecorderMessage,
  type RecorderState,
  type RecordingSessionEvent,
  type StreamDeckPress,
} from "./protocol";
import type { RecordingSession, TakeSettings } from "./recording-session";
import { createTakeArming } from "./take-arming";
import { createTakeStopping } from "./take-stopping";
import { createSessionIndex } from "./session-index";
import { checkFfmpeg, checkNvidiaDriver } from "./windows-devices";
import { Refusal } from "./refusal";
import { RECORDER_CAMERA_NAME } from "../app/av-calibration-constants";
import { createRecordingDevices } from "./recording-devices";
import {
  createScreenSide,
  refuseScreenlessScene,
  refuseWakingScene,
} from "./screen-side";
import { createPreviewEncoders } from "./preview-encoders";

/**
 * THE RECORDER SERVICE (ADR 0034): a long-running process of its own in WSL
 * that records camera, screen and mic for one Video at a time, through
 * ffmpeg.exe on Windows. It never touches the database. Its interface is one
 * WebSocket (`protocol.ts`); its durable record is each Recording Session's
 * `events.jsonl`, beside the Footage.
 *
 * Commands are handled one at a time, in the order they arrive, so a `stop`
 * can never overtake the `record` it stops.
 *
 * It holds the Cam Link and the mic only while the recorder is open for a
 * Video, in the camera capture (`camera.ts`); Record is refused until it is
 * live. Record and Stop never reopen a device or touch a preview (#2207):
 * the next take's writer is armed once the editor says what it records with
 * (`prepare-record`, `take-arming.ts`), and Record tells it T0.
 *
 * The screen depends on the Video's format. Landscape records the DELL,
 * checked at Record. A Short records the Spacedesk virtual display: opening
 * looks for it and wakes Spacedesk when it is not listed, beside the camera
 * and outside the command queue, and the state says how that went
 * (`ScreenStatus`, `screen-side.ts`). With it unavailable a Short records camera and mic only,
 * and refuses the scenes that draw the screen.
 *
 * The level meter (`level-meter.ts`) holds only the mic, and needs no Video:
 * it runs whether the recorder is closed or open, for the client that started
 * it, until it asks to stop or goes. It and a recording never run together,
 * and neither does an AV Calibration's run, which takes the meter's place
 * while it writes the mic and the camera to files (`calibration-run.ts`).
 */

/** The devices the rig proved, found by name. */
export const CAMERA_NAME = RECORDER_CAMERA_NAME;

export type RecorderServiceOptions = {
  /** 0 picks a free port (tests). */
  port: number;
  launch: Launcher;
  /** Windows wall-clock ms: the clock ffmpeg stamps every input with. */
  now: () => number;
  /** The service's own files: the last NVIDIA driver seen, the Recording Session index. */
  stateDir: string;
  /** How long one try at the Cam Link waits for its first frame. */
  cameraStartTimeoutMs?: number;
  /** `PREVIEW_STALL_MS` (tests). */
  previewStallMs?: number;
  /**
   * Wakes the Spacedesk display (`app/spacedesk-wake.ts`); rejects with a
   * message that says why it could not.
   */
  wakeSpacedesk: () => Promise<void>;
};

export const startRecorderService = async (o: RecorderServiceOptions) => {
  const ffmpeg = await checkFfmpeg(o.launch);
  const warnings: string[] = [];
  if (ffmpeg.ok) {
    const driver = await checkNvidiaDriver(o.launch, o.stateDir);
    if (driver) warnings.push(driver);
  }

  const index = createSessionIndex(o.stateDir);

  let state: RecorderState = { kind: "closed" };
  /** The scene the picture is drawn in; kept while the service runs. */
  let scene: Scene = DEFAULT_SCENE;
  /** What a Stream Deck Record records with, from the app server. */
  let recordWith:
    Extract<RecorderCommand, { type: "prepare-record" }> | undefined;
  let listening: () => void = () => {};
  let session: RecordingSession | undefined;
  /** Takes stopped and still closing their files (#2211). */
  const stopping = createTakeStopping({ rearm: () => rearm() });
  let camera: Camera | undefined;
  const feeds = await startPreviewFeeds();
  const encoders = createPreviewEncoders();

  const server = http.createServer((req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403, { Vary: "Origin" }).end();
      return;
    }
    if (feeds.serve(req, res, corsHeaders(req.headers.origin))) return;
    if (req.method === "GET" && req.url === STILL_PATH)
      return serveStill(req, res, state, feeds.latestStill());
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "recorder", pid: process.pid, state }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ origin }: { origin?: string }) =>
      isAllowedOrigin(origin || undefined),
  });
  // An error event nobody listens for kills the process, and with it the
  // only thing that can send ffmpeg.exe its `q`. No client may do that.
  wss.on("error", (e) => console.error("recorder: WebSocket server error", e));
  const send = (ws: WebSocket, message: RecorderMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: RecorderMessage) => {
    for (const ws of wss.clients) send(ws, message);
  };
  const setState = (next: RecorderState) => {
    state = next;
    broadcast({ type: "state", state });
  };

  const devices = createRecordingDevices(o.launch);
  const findCamera = devices.findCamera;

  /** What the next take records with, if the recorder can arm it now. */
  const wantedTake = (): TakeSettings | undefined => {
    const capture = camera?.capture();
    if (
      state.kind !== "open" ||
      session ||
      stopping.relayHeld() ||
      !capture ||
      recordWith?.videoId !== state.videoId ||
      !recordWith.calibration
    )
      return undefined;
    return {
      folder: recordWith.folder,
      silenceLength: recordWith.silenceLength,
      thresholdDb: recordWith.calibration.thresholdDb,
      relayPort: capture.writerRelay,
    };
  };

  const arming = createTakeArming({
    launch: o.launch,
    now: o.now,
    wanted: wantedTake,
  });
  const rearm = arming.rearm;

  /** Opens the Cam Link and the mic for the open recorder; its status goes in the state. */
  const startCamera = (): CameraStatus => {
    camera = openCamera({
      launch: o.launch,
      feeds,
      encoders,
      findDevices: devices.findPair,
      startTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
      previewStallMs: o.previewStallMs,
      recording: () => session !== undefined,
      onStatus: (status) => {
        if (state.kind === "open") setState({ ...state, camera: status });
        rearm();
      },
    });
    return camera.status();
  };

  const releaseCamera = async () => {
    // A take still closing its files reads the capture until it is done.
    await stopping.finished();
    const released = camera;
    camera = undefined;
    await Promise.all([arming.disarm(), released?.release()]);
  };

  const meter = createMeterSide<WebSocket>({
    launch: o.launch,
    broadcast,
    now: o.now,
    findCamera: async () => {
      const found = await findCamera();
      if (!found)
        throw new Refusal(
          `${CAMERA_NAME} (video) is not among the DirectShow devices.`
        );
      return found;
    },
    startTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
    // The Cam Link opens in one process at a time: the preview makes way.
    takeCamera: releaseCamera,
    giveBackCamera: () => {
      if (state.kind === "open" && !camera)
        setState({ ...state, camera: startCamera() });
    },
  });

  const screenSide = createScreenSide({
    launch: o.launch,
    encoders,
    previewPort: () => feeds.port("screen"),
    onPreviewFrame: (listener) => feeds.onFrame("screen", listener),
    previewStallMs: o.previewStallMs,
    wakeSpacedesk: o.wakeSpacedesk,
    format: () => (state.kind === "closed" ? undefined : state.format),
    setStatus: (screen) => {
      if (state.kind === "closed" || state.format !== "short") return;
      // An open for a Short already went in waking.
      if (screen.kind !== "waking" || state.screen?.kind !== "waking")
        setState({ ...state, screen });
    },
  });

  const onEvent = (event: RecordingSessionEvent) => {
    // A stopped take's last events can come after the next take started.
    if (
      state.kind === "recording" &&
      state.recordingSessionId === event.recordingSessionId
    )
      state = { ...state, lastSeq: event.seq };
    broadcast(event);
  };

  const screenStatus = () => (state.kind === "closed" ? null : state.screen);

  /** Open again after a Recording Session, the next take armed. */
  const reopen = (videoId: string) => {
    if (state.kind === "closed") return;
    setState({
      kind: "open",
      videoId,
      format: state.format,
      scene,
      screen: state.screen,
      camera: camera?.status() ?? startCamera(),
    });
    rearm();
  };

  /** Stop (`take-stopping.ts`): open again at the press, the take finalising behind. */
  const stopTake = () => {
    if (!session || state.kind !== "recording")
      throw new Refusal("Not recording.");
    const startedMs = Date.now();
    stopping.stop(session);
    session = undefined;
    reopen(state.videoId);
    console.log(
      `recorder: Stop took ${Date.now() - startedMs} ms to open again; the take finalises in the background, preview untouched`
    );
  };

  const record = async (
    command: Extract<RecorderCommand, { type: "record" }>
  ) => {
    if (state.kind === "closed")
      throw new Refusal("Open the recorder for a Video first.");
    if (state.kind === "recording") throw new Refusal("Already recording.");
    if (meter.running()) throw new Refusal(RECORD_WHILE_METERING);
    if (state.camera.kind !== "live")
      throw new Refusal("The camera is not live yet.");
    if (!path.isAbsolute(command.folder)) {
      throw new Refusal(
        `The folder must be an absolute path: ${command.folder}`
      );
    }
    const startedMs = Date.now();
    const capture = camera?.capture();
    if (!capture) throw new Refusal("The camera is not live yet.");
    const {
      camera: cameraName,
      mic,
      calibration,
      fromCache,
    } = await devices.forRecord(command.calibration, o.now);
    if (cameraName !== capture.devices.camera || mic !== capture.devices.mic)
      throw new Refusal(
        `The recorder opened ${capture.devices.camera} and ${capture.devices.mic}, but the devices now listed are ${cameraName} and ${mic}: close the recorder and open it again.`
      );
    const devicesMs = Date.now();
    const { videoId, format } = state;
    const screenIndex = await screenSide.recordIndex(
      format,
      state.screen,
      scene
    );
    const screenMs = Date.now();
    // Straight after a Stop the last take's writer may still hold the relay.
    const relayWasHeld = stopping.relayHeld();
    await stopping.relayFree();
    const wasArmed = arming.isArmed();
    const take = await arming.takeFor({
      folder: command.folder,
      silenceLength: command.silenceLength,
      thresholdDb: calibration.thresholdDb,
      relayPort: capture.writerRelay,
    });
    const armedMs = Date.now();
    try {
      const begun: RecordingSession = take.begin({
        videoId,
        avCalibrationId: calibration.id,
        capture,
        screenIndex,
        format,
        cameraStartTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
        scene,
        emit: onEvent,
        // A take that stopped on its own (the camera lost, a process quit);
        // one stopped on request was let go at the press (`stopTake`).
        onEnded: () => {
          if (session !== begun) return;
          session = undefined;
          reopen(videoId);
        },
      });
      session = begun;
    } catch (e) {
      reopen(videoId);
      throw e;
    }
    index.add({ recordingSessionId: session.id, eventLog: session.eventLog });
    console.log(
      `recorder: Record took ${armedMs - startedMs} ms to T0 (devices ${devicesMs - startedMs} ms${fromCache ? ", cached" : ""}, screen ${screenMs - devicesMs} ms, writer ${armedMs - screenMs} ms, ${wasArmed && armedMs - screenMs < 5 ? "armed" : relayWasHeld ? "armed at Record: the last take's writer still held the relay" : "armed at Record"}); no device reopened, preview untouched`
    );
    setState({
      kind: "recording",
      videoId,
      format,
      scene,
      screen: screenStatus(),
      recordingSessionId: session.id,
      lastSeq: session.lastSeq(),
    });
  };

  const replay = (
    ws: WebSocket,
    recordingSessionId: string,
    afterSeq: number
  ) => {
    const { events, lastSeq } = index.replay(recordingSessionId, afterSeq);
    for (const event of events) send(ws, event);
    send(ws, { type: "replay-done", recordingSessionId, lastSeq });
  };

  /** A Stream Deck button: acts on whichever Video the recorder is open for. */
  const press = async (ws: WebSocket, p: StreamDeckPress): Promise<void> => {
    if (state.kind === "closed")
      throw new Refusal(
        "The recorder is not open: open the editor on a CVM recorder Video first."
      );
    const pressed = resolveToggle(p, state);
    switch (pressed.action) {
      case "record":
        if (recordWith?.videoId !== state.videoId)
          throw new Refusal(
            "The editor has not said its Silence Length yet: reload the editor."
          );
        return record({
          type: "record",
          silenceLength: recordWith.silenceLength,
          folder: recordWith.folder,
          calibration: recordWith.calibration,
        });
      case "stop":
        return handle(ws, { type: "stop" });
      case "switch-scene":
        refuseWakingScene(pressed.scene, state.format, state.screen);
        return handle(ws, { type: "switch-scene", scene: pressed.scene });
    }
  };

  const handle = async (
    ws: WebSocket,
    command: RecorderCommand
  ): Promise<void> => {
    if (command.type === "replay") {
      return replay(ws, command.recordingSessionId, command.afterSeq);
    }
    if (!ffmpeg.ok) throw new Refusal(ffmpeg.message);
    switch (command.type) {
      case "open": {
        if (state.kind === "recording") {
          throw new Refusal(
            "Stop recording before opening the recorder for another Video."
          );
        }
        const format = command.format ?? "landscape";
        const screen = format === "short" ? { kind: "waking" as const } : null;
        if (state.kind === "open") {
          if (state.format === format) {
            setState({ ...state, videoId: command.videoId });
            return rearm();
          }
          setState({ ...state, videoId: command.videoId, format, screen });
          rearm();
          return void screenSide.restart();
        }
        setState({
          kind: "open",
          videoId: command.videoId,
          format,
          camera: startCamera(),
          scene,
          screen,
        });
        return void screenSide.restart();
      }
      case "retry-camera":
        if (state.kind !== "open" || !camera?.retry())
          throw new Refusal("The camera is not waiting for a retry.");
        return;
      case "retry-screen":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before waking Spacedesk again.");
        if (state.kind !== "open" || state.format !== "short")
          throw new Refusal("The recorder is not open for a Short.");
        if (state.screen?.kind === "waking")
          throw new Refusal("Spacedesk is already waking.");
        return void screenSide.restart();
      case "switch-scene":
        if (state.kind === "closed")
          throw new Refusal("Open the recorder for a Video first.");
        refuseScreenlessScene(command.scene, state.format, state.screen);
        // While recording, logged first: a clock that cannot be read refuses
        // the switch rather than showing a scene the Footage never got.
        session?.switchScene(command.scene);
        scene = command.scene;
        return setState({ ...state, scene });
      case "record":
        return record(command);
      case "stop":
        return stopTake();
      case "prepare-record":
        recordWith = command;
        return rearm();
      case "stream-deck":
        // Whatever the reason, the press does nothing; every client hears why.
        return press(ws, command.press).catch((e: unknown) => {
          if (!(e instanceof Refusal))
            console.error("recorder: a Stream Deck press failed", e);
          const message = e instanceof Error ? e.message : String(e);
          broadcast({
            type: "stream-deck-ignored",
            press: command.press,
            message,
          });
        });
      case "start-meter":
        if (state.kind === "recording")
          throw new Refusal(METER_WHILE_RECORDING);
        return meter.start(ws);
      case "stop-meter":
        return meter.stop();
      case "start-calibration":
        if (state.kind === "recording")
          throw new Refusal(CALIBRATION_WHILE_RECORDING);
        return meter.startCalibration(ws, command.folder);
      case "finish-calibration":
        return meter.finishCalibration(command);
      case "cancel-calibration":
        return meter.cancelCalibration();
      case "close":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before closing the recorder.");
        recordWith = undefined;
        if (state.kind === "closed") return setState(state);
        setState({ kind: "closed" });
        await Promise.all([releaseCamera(), screenSide.close()]);
        return;
    }
  };

  let recovered: string[] = [];
  // Crash recovery runs before any command and any greeting, so a client
  // hears of every Recording Session it repaired. Only once listening: a
  // second service that cannot take the port must not touch the files.
  let queue: Promise<void> = Promise.resolve();
  const recovering = new Promise<void>((resolve) => {
    listening = resolve;
  }).then(async () => {
    if (!ffmpeg.ok) return;
    try {
      recovered = await recoverCrashedSessions({
        launch: o.launch,
        index: index.read(),
      });
    } catch (e) {
      console.error("recorder: crash recovery failed", e);
    }
  });
  queue = recovering;
  wss.on("connection", (ws) => {
    // ws raises a client's protocol violation (an unmasked or oversized
    // frame, bad UTF-8) on its socket: drop that client, keep recording.
    ws.on("error", (e) => {
      console.error("recorder: dropping a client that broke the protocol", e);
      ws.terminate();
    });
    // The meter runs for the client that started it: one that goes (the app
    // server stopped) must not leave the mic open and Record refused.
    ws.on("close", () => {
      queue = queue.then(() => meter.ownerWent(ws).catch(() => {}));
    });
    void recovering.then(() =>
      send(ws, {
        type: "hello",
        protocol: RECORDER_PROTOCOL_VERSION,
        ffmpeg,
        warnings,
        state,
        recovered,
        recent: index.recent(),
      })
    );
    ws.on("message", (data) => {
      const decoded = decodeCommand(data.toString());
      if (Either.isLeft(decoded)) {
        const refusal = refusalOfUndecodable(data.toString());
        if (refusal) return send(ws, { type: "refused", ...refusal });
        console.error(
          `recorder: unreadable command ${data.toString().slice(0, 200)}`
        );
        return;
      }
      const command = decoded.right;
      queue = queue.then(async () => {
        try {
          await handle(ws, command);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!(e instanceof Refusal))
            console.error(`recorder: ${command.type} failed`, e);
          send(ws, { type: "refused", command: command.type, message });
        }
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  listening();

  return {
    port: (server.address() as AddressInfo).port,
    /** Stops a recording cleanly, then closes every socket. */
    close: async () => {
      await queue;
      if (session) await session.stop();
      // releaseCamera waits for every take still closing its files.
      await Promise.all([releaseCamera(), screenSide.close(), meter.stop()]);
      await feeds.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
