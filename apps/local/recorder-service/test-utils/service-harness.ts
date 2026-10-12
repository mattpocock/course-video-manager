import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { WebSocket } from "ws";
import { fakeWindows } from "./fake-windows";
import type { RecorderCommand, RecorderMessage } from "../protocol";
import { startRecorderService } from "../recorder-service";

/**
 * The recorder service driven through its WebSocket, with the process
 * launcher as the only fake: a scripted Windows whose ffmpeg.exe answers
 * -version and -list_devices, and whose recorders print what the test tells
 * them to and quit on `q`. Nothing here opens a real device. Importing this
 * registers the `afterEach` that stops every service and removes every
 * temp folder a test made.
 */

export const T0_MS = 1_760_000_000_000;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

export const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recorder-service-"));
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** The Windows wall clock the service reads; tests move it on. */
export const clock = { ms: T0_MS };
afterEach(() => {
  clock.ms = T0_MS;
});

export const start = async (windows = fakeWindows(), stateDir = tmp()) => {
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => clock.ms,
    stateDir,
    cameraStartTimeoutMs: 100,
  });
  cleanups.unshift(() => service.close());
  return { windows, stateDir, port: service.port, close: service.close };
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
  client.send({ type: "record", silenceLength: "long", folder });
  const started = await client.next("recording-started");
  return { ...s, client, started, folder };
};
