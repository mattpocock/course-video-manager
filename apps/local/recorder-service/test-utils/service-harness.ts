import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { WebSocket } from "ws";
import { fakeWindows } from "./fake-windows";
import type { RecorderCommand, RecorderMessage } from "../protocol";
import { LIVE_STREAM_SETTINGS } from "../go-live";
import { startRecorderService } from "../recorder-service";
import { DEFAULT_SILENCE_THRESHOLD_DB } from "../../app/silence-detection-constants";
import type { LastPassedCalibration } from "../../app/av-calibration-constants";

/**
 * The recorder service driven through its WebSocket, with the process
 * launcher as the only fake: a scripted Windows whose ffmpeg.exe answers
 * -version and -list_devices, and whose recorders print what the test tells
 * them to and quit on `q`. Nothing here opens a real device. Importing this
 * registers the `afterEach` that stops every service and removes every
 * temp folder a test made.
 */

export const T0_MS = 1_760_000_000_000;

/** The scripted Windows' mic, as the service finds it among its devices. */
export const FAKE_MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";

/**
 * An AV Calibration that lets a Record through (ADR 0038): taken a day
 * before the service's clock, on its mic, at the fixed default threshold.
 */
export const CALIBRATION: LastPassedCalibration = {
  id: "calibration-ok",
  createdAtMs: T0_MS - 24 * 60 * 60 * 1000,
  thresholdDb: DEFAULT_SILENCE_THRESHOLD_DB,
  recorderMic: FAKE_MIC,
  cameraDevice: "Cam Link 4K",
};

/** What a Record carries to be let through the gate. */
export const CALIBRATED = { calibration: CALIBRATION };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

export const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recorder-service-"));
  // Not retried: the service closes every file before its close resolves,
  // so one still being written here is a bug to see.
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/**
 * Holds every thread of libuv's threadpool, where Node opens and writes
 * files, until `release`: each thread blocks opening a FIFO's read end. Any
 * file write queued meanwhile waits, so a test can see whether the service
 * waited for one. Released before the service closes, which waits for its
 * writes.
 */
export const holdThreadpool = () => {
  const dir = tmp();
  // libuv's default size; the tests never change it.
  const fifos = Array.from({ length: 4 }, (_, i) => {
    const fifo = path.join(dir, `hold-${i}`);
    execFileSync("mkfifo", [fifo]);
    fs.open(fifo, "r", (error, fd) => {
      if (!error) fs.closeSync(fd);
    });
    return fifo;
  });
  let released: Promise<void> | undefined;
  /** Opens each FIFO's write end, once its reader is waiting, freeing that thread. */
  const release = () =>
    (released ??= (async () => {
      for (const fifo of fifos) {
        for (;;) {
          try {
            const flags = fs.constants.O_WRONLY | fs.constants.O_NONBLOCK;
            fs.closeSync(fs.openSync(fifo, flags));
            break;
          } catch (e) {
            // ENXIO: its reader has not reached the open yet.
            if ((e as NodeJS.ErrnoException).code !== "ENXIO") throw e;
            await new Promise((r) => setImmediate(r));
          }
        }
      }
    })());
  cleanups.unshift(release);
  return { release };
};

/** The Windows wall clock the service reads; tests move it on. */
export const clock = { ms: T0_MS };
afterEach(() => {
  clock.ms = T0_MS;
});

export const start = async (
  windows = fakeWindows(),
  stateDir = tmp(),
  o: {
    previewStallMs?: number;
    streamIngest?: string;
    streamListenBoundMs?: number;
    streamStallMs?: number;
    cardAnswerMs?: number;
  } = {}
) => {
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => clock.ms,
    stateDir,
    cameraStartTimeoutMs: 100,
    previewStallMs: o.previewStallMs,
    wakeSpacedesk: windows.wakeSpacedesk,
    ...LIVE_STREAM_SETTINGS,
    streamIngest: o.streamIngest ?? LIVE_STREAM_SETTINGS.streamIngest,
    streamListenBoundMs:
      o.streamListenBoundMs ?? LIVE_STREAM_SETTINGS.streamListenBoundMs,
    streamStallMs: o.streamStallMs ?? LIVE_STREAM_SETTINGS.streamStallMs,
    cardAnswerMs: o.cardAnswerMs ?? LIVE_STREAM_SETTINGS.cardAnswerMs,
  });
  cleanups.unshift(() => service.close());
  return {
    windows,
    stateDir,
    port: service.port,
    close: service.close,
    busy: service.busy,
  };
};

export const connect = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const received: RecorderMessage[] = [];
  const waiters: {
    match: (m: RecorderMessage) => boolean;
    resolve: (m: RecorderMessage) => void;
  }[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as RecorderMessage;
    received.push(message);
    for (const w of waiters.slice()) {
      if (w.match(message)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(message);
      }
    }
  });
  await new Promise((r) => ws.once("open", r));
  cleanups.unshift(async () => ws.close());
  /** The first unconsumed message of a type (and matching `where`), consuming it and any skipped. */
  const next = <T extends RecorderMessage["type"]>(
    type: T,
    where: (m: Extract<RecorderMessage, { type: T }>) => boolean = () => true
  ) => {
    const matches = (m: RecorderMessage) =>
      m.type === type && where(m as Extract<RecorderMessage, { type: T }>);
    const seen = received.find(matches);
    if (seen) {
      received.splice(received.indexOf(seen), 1);
      return Promise.resolve(seen as Extract<RecorderMessage, { type: T }>);
    }
    return new Promise<Extract<RecorderMessage, { type: T }>>((resolve) =>
      waiters.push({
        match: (m) =>
          matches(m) && (received.splice(received.indexOf(m), 1), true),
        resolve: (m) => resolve(m as Extract<RecorderMessage, { type: T }>),
      })
    );
  };
  /** The next state with the camera in this kind. */
  const camera = (kind: string) =>
    next(
      "state",
      (m) => m.state.kind === "open" && m.state.camera.kind === kind
    );
  return {
    send: (command: RecorderCommand) => ws.send(JSON.stringify(command)),
    next,
    camera,
    received,
  };
};

export const readLog = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { seq: number; type: string });

export const recordOnce = async (
  windows: Parameters<typeof fakeWindows>[0] = {}
) => {
  const s = await start(fakeWindows(windows));
  const folder = tmp();
  const client = await connect(s.port);
  await client.next("hello");
  client.send({ type: "open", videoId: "video-1" });
  await client.camera("live");
  client.send({ type: "record", silenceLength: "long", folder, ...CALIBRATED });
  const started = await client.next("recording-started");
  return { ...s, client, started, folder };
};
