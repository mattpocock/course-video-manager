import { Either, Schema } from "effect";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { corsHeaders, isAllowedOrigin } from "./allowed-origin";
import { recoverCrashedSessions, type IndexEntry } from "./crash-recovery";
import {
  CAMERA_START_TIMEOUT_MS,
  openCamera,
  quitProcess,
  type Camera,
} from "./camera";
import { screenPreviewArgs } from "./capture-args";
import type { LaunchedProcess, Launcher } from "./launcher";
import {
  DEFAULT_SCENE,
  SCENES,
  type Scene,
} from "../app/packages/scene-layout";
import { startPreviewFeeds } from "./preview-feeds";
import {
  STILL_NO_PICTURE,
  STILL_PATH,
  STILL_RECORDER_CLOSED,
  STILL_WHILE_RECORDING,
  type CameraStatus,
  type RecorderCommand,
  type RecorderMessage,
  type RecorderState,
  type RecordingSessionEvent,
  type StreamDeckPress,
} from "./protocol";
import {
  startRecordingSession,
  type RecordingSession,
} from "./recording-session";
import {
  checkFfmpeg,
  checkNvidiaDriver,
  listDshowDevices,
  listScreens,
} from "./windows-devices";

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
 * It holds the Cam Link only while the recorder is open for a Video: opening
 * opens it (`camera.ts`) and the screen preview; Record is refused until the
 * camera is live; Record hands the Cam Link from the preview process to the
 * recording, and the end of the recording hands it back; closing lets it go.
 */

/** The devices the rig proved, found by name. */
export const CAMERA_NAME = "Cam Link 4K";
export const MIC_NAME = "Voicemeeter Out B1";
export const SCREEN_NAME = "DELL U2424H";

/** A still older than this is not the camera now: the preview process stalled or quit. */
const STILL_MAX_AGE_MS = 2_000;

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
};

const Command = Schema.Union(
  Schema.Struct({ type: Schema.Literal("open"), videoId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("record"),
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("retry-camera") }),
  Schema.Struct({
    type: Schema.Literal("switch-scene"),
    scene: Schema.Literal(...SCENES),
  }),
  Schema.Struct({
    type: Schema.Literal("prepare-record"),
    videoId: Schema.String,
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("stream-deck"),
    press: Schema.Union(
      Schema.Struct({ action: Schema.Literal("record", "stop") }),
      Schema.Struct({
        action: Schema.Literal("switch-scene"),
        scene: Schema.Literal(...SCENES),
      })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("replay"),
    recordingSessionId: Schema.String,
    afterSeq: Schema.Number,
  })
);
const decodeCommand = Schema.decodeUnknownEither(Schema.parseJson(Command));

class Refusal extends Error {}

const findByName = <T>(items: T[], name: (t: T) => string, wanted: string) =>
  items.find((t) => name(t).toLowerCase().includes(wanted.toLowerCase()));

export const startRecorderService = async (o: RecorderServiceOptions) => {
  const ffmpeg = await checkFfmpeg(o.launch);
  const warnings: string[] = [];
  if (ffmpeg.ok) {
    const driver = await checkNvidiaDriver(o.launch, o.stateDir);
    if (driver) warnings.push(driver);
  }

  const indexFile = path.join(o.stateDir, "recording-sessions.jsonl");
  fs.mkdirSync(o.stateDir, { recursive: true });
  /** Every Recording Session the service has started, oldest first. */
  const readIndex = (): IndexEntry[] =>
    fs.existsSync(indexFile)
      ? fs
          .readFileSync(indexFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as IndexEntry)
      : [];
  /** Where a Recording Session's event log is, from the index the service keeps. */
  const eventLogOf = (recordingSessionId: string) =>
    readIndex().find((e) => e.recordingSessionId === recordingSessionId)
      ?.eventLog;

  let state: RecorderState = { kind: "closed" };
  /** The scene the picture is drawn in; kept while the service runs. */
  let scene: Scene = DEFAULT_SCENE;
  /** What a Stream Deck Record records with, from the app server. */
  let recordWith:
    Extract<RecorderCommand, { type: "prepare-record" }> | undefined;
  let listening: () => void = () => {};
  let session: RecordingSession | undefined;
  let camera: Camera | undefined;
  let screenPreview: LaunchedProcess | undefined;
  const feeds = await startPreviewFeeds();

  /** `GET /still`: the camera's latest still, or why there is none. */
  const serveStill = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const headers = {
      "Cache-Control": "no-store",
      ...corsHeaders(req.headers.origin),
    };
    const still = feeds.latest("still");
    const refusal =
      state.kind === "closed"
        ? STILL_RECORDER_CLOSED
        : state.kind === "recording"
          ? STILL_WHILE_RECORDING
          : state.camera.kind !== "live" ||
              !still ||
              Date.now() - still.atMs > STILL_MAX_AGE_MS
            ? STILL_NO_PICTURE
            : undefined;
    if (refusal || !still) {
      res.writeHead(state.kind === "open" ? 503 : 409, {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(refusal);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": "image/jpeg" });
    res.end(still.jpeg);
  };

  const server = http.createServer((req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403, { Vary: "Origin" }).end();
      return;
    }
    if (feeds.serve(req, res, corsHeaders(req.headers.origin))) return;
    if (req.method === "GET" && req.url === STILL_PATH)
      return serveStill(req, res);
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

  const findCamera = async () => {
    const { devices } = await listDshowDevices(o.launch);
    return findByName(
      devices.filter((d) => d.kind === "video").map((d) => d.name),
      (n) => n,
      CAMERA_NAME
    );
  };

  /** Opens the Cam Link for the open recorder; its status goes in the state. */
  const startCamera = (): CameraStatus => {
    camera = openCamera({
      launch: o.launch,
      feeds,
      findCamera,
      startTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
      onStatus: (status) => {
        if (state.kind === "open") setState({ ...state, camera: status });
      },
    });
    return camera.status();
  };

  const releaseCamera = async () => {
    const released = camera;
    camera = undefined;
    await released?.release();
  };

  const startScreenPreview = async () => {
    const screens = await listScreens(o.launch);
    const screen = findByName(screens, (s) => s.name, SCREEN_NAME);
    if (!screen || state.kind === "closed" || screenPreview) return;
    const p = o.launch({
      tool: "ffmpeg",
      args: screenPreviewArgs({
        screenIndex: screen.index,
        port: feeds.port("screen"),
      }),
      cwd: "/mnt/c",
    });
    screenPreview = p;
    void p.exited.then((code) => {
      if (screenPreview !== p) return;
      screenPreview = undefined;
      console.error(`recorder: the screen preview quit (exit ${code})`);
    });
  };

  const stopScreenPreview = async () => {
    const p = screenPreview;
    screenPreview = undefined;
    if (p) await quitProcess(p);
  };

  const onEvent = (event: RecordingSessionEvent) => {
    if (state.kind === "recording") state = { ...state, lastSeq: event.seq };
    broadcast(event);
  };

  const record = async (
    command: Extract<RecorderCommand, { type: "record" }>
  ) => {
    if (state.kind === "closed")
      throw new Refusal("Open the recorder for a Video first.");
    if (state.kind === "recording") throw new Refusal("Already recording.");
    if (state.camera.kind !== "live")
      throw new Refusal("The camera is not live yet.");
    if (!path.isAbsolute(command.folder)) {
      throw new Refusal(
        `The folder must be an absolute path: ${command.folder}`
      );
    }
    const { devices, raw } = await listDshowDevices(o.launch);
    const names = (kind: "video" | "audio") =>
      devices.filter((d) => d.kind === kind).map((d) => d.name);
    const camera = findByName(names("video"), (n) => n, CAMERA_NAME);
    const mic = findByName(names("audio"), (n) => n, MIC_NAME);
    if (!camera || !mic) {
      const missing = !camera
        ? `${CAMERA_NAME} (video)`
        : `${MIC_NAME} (audio)`;
      throw new Refusal(
        `${missing} is not among the DirectShow devices. Found: ${devices.map((d) => `${d.name} (${d.kind})`).join(", ") || `none. ffmpeg said: ${raw.slice(0, 500)}`}`
      );
    }
    const screens = await listScreens(o.launch);
    const screen = findByName(screens, (s) => s.name, SCREEN_NAME);
    if (!screen) {
      throw new Refusal(
        `No screen named ${SCREEN_NAME}. Found: ${screens.map((s) => s.name).join(", ") || "none"}`
      );
    }
    if (screen.width !== 1920 || screen.height !== 1080) {
      throw new Refusal(
        `The ${SCREEN_NAME} is ${screen.width}x${screen.height}; the recorder records it at 1920x1080.`
      );
    }
    const videoId = state.videoId;
    // The Cam Link opens in one process at a time: the recording's takes it
    // over from the preview, and hands it back when it ends.
    await releaseCamera();
    try {
      session = startRecordingSession({
        launch: o.launch,
        now: o.now,
        videoId,
        folder: command.folder,
        silenceLength: command.silenceLength,
        camera,
        mic,
        screenIndex: screen.index,
        cameraPreviewPort: feeds.port("camera"),
        cameraStartTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
        scene,
        emit: onEvent,
        onEnded: () => {
          session = undefined;
          setState({ kind: "open", videoId, camera: startCamera(), scene });
        },
      });
    } catch (e) {
      setState({ kind: "open", videoId, camera: startCamera(), scene });
      throw e;
    }
    fs.appendFileSync(
      indexFile,
      `${JSON.stringify({ recordingSessionId: session.id, eventLog: session.eventLog })}\n`
    );
    setState({
      kind: "recording",
      videoId,
      scene,
      recordingSessionId: session.id,
      lastSeq: session.lastSeq(),
    });
  };

  const replay = (
    ws: WebSocket,
    recordingSessionId: string,
    afterSeq: number
  ) => {
    const eventLog = eventLogOf(recordingSessionId);
    if (!eventLog || !fs.existsSync(eventLog)) {
      throw new Refusal(
        `No event log for Recording Session ${recordingSessionId}.`
      );
    }
    let lastSeq = 0;
    for (const line of fs.readFileSync(eventLog, "utf8").split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as RecordingSessionEvent;
      lastSeq = Math.max(lastSeq, event.seq);
      if (event.seq > afterSeq) send(ws, event);
    }
    send(ws, { type: "replay-done", recordingSessionId, lastSeq });
  };

  /** A Stream Deck button: acts on whichever Video the recorder is open for. */
  const press = async (ws: WebSocket, p: StreamDeckPress): Promise<void> => {
    if (state.kind === "closed")
      throw new Refusal(
        "The recorder is not open: open the editor on a New recorder Video first."
      );
    switch (p.action) {
      case "record":
        if (recordWith?.videoId !== state.videoId)
          throw new Refusal(
            "The editor has not said its Silence Length yet: press Record in the editor."
          );
        return record({
          type: "record",
          silenceLength: recordWith.silenceLength,
          folder: recordWith.folder,
        });
      case "stop":
        return handle(ws, { type: "stop" });
      case "switch-scene":
        return handle(ws, { type: "switch-scene", scene: p.scene });
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
      case "open":
        if (state.kind === "recording") {
          throw new Refusal(
            "Stop recording before opening the recorder for another Video."
          );
        }
        if (state.kind === "open") {
          return setState({ ...state, videoId: command.videoId });
        }
        setState({
          kind: "open",
          videoId: command.videoId,
          camera: startCamera(),
          scene,
        });
        return void startScreenPreview();
      case "retry-camera":
        if (state.kind !== "open" || !camera?.retry())
          throw new Refusal("The camera is not waiting for a retry.");
        return;
      case "switch-scene":
        if (state.kind === "closed")
          throw new Refusal("Open the recorder for a Video first.");
        // While recording, logged first: a clock that cannot be read refuses
        // the switch rather than showing a scene the Footage never got.
        session?.switchScene(command.scene);
        scene = command.scene;
        return setState({ ...state, scene });
      case "record":
        return record(command);
      case "stop":
        if (!session) throw new Refusal("Not recording.");
        return session.stop();
      case "prepare-record":
        recordWith = command;
        return;
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
      case "close":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before closing the recorder.");
        recordWith = undefined;
        if (state.kind === "closed") return setState(state);
        setState({ kind: "closed" });
        await Promise.all([releaseCamera(), stopScreenPreview()]);
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
        index: readIndex(),
      });
    } catch (e) {
      console.error("recorder: crash recovery failed", e);
    }
  });
  queue = recovering;
  wss.on("connection", (ws) => {
    void recovering.then(() =>
      send(ws, { type: "hello", ffmpeg, warnings, state, recovered })
    );
    ws.on("message", (data) => {
      const decoded = decodeCommand(data.toString());
      if (Either.isLeft(decoded)) {
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
      await Promise.all([releaseCamera(), stopScreenPreview()]);
      await feeds.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
