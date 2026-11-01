import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, vi } from "vitest";
import { Effect, Layer } from "effect";
import { WebSocket, WebSocketServer } from "ws";
import type { RecorderCommand } from "recorder-service/protocol";
import {
  CALIBRATION,
  start,
  tmp,
} from "recorder-service/test-utils/service-harness";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { DrizzleService } from "@/services/drizzle-service.server";
import { avCalibrations } from "@/db/schema";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { clipService, testDb } from "../clip-service-test-setup";
import { lastPassedCalibration } from "../av-calibration.server";
import {
  createRecorderClient,
  type RecorderClientOptions,
} from "./client.server";
import {
  ingestRecorderEvent,
  unfinishedRecordingSessions,
} from "./ingest.server";

/**
 * The recorder client end to end, without hardware: the real recorder
 * service on a scripted Windows (its fake ffmpeg.exe, via the service's own
 * test harness, whose `afterEach` stops it), the app server's recorder
 * client, and the test database (the test file calls
 * `setupClipServiceTests()`).
 */

export { tmp };

const clients: { close: () => void }[] = [];
// Registered after the service harness's, so (after hooks run as a stack)
// clients close before the service they talk to.
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

/** The recorder service on a scripted Windows (`fakeWindows`, never the real Spacedesk). */
export const startService = async (
  stateDir = tmp(),
  windows = fakeWindows(),
  o: Parameters<typeof start>[2] = {}
) => {
  const { port, busy } = await start(windows, stateDir, o);
  return { windows, port, stateDir, busy };
};

export type Ingest = RecorderClientOptions["ingest"];

/** The real ingest, on the test database. */
export const saveEvent: Ingest = (event, askEditor) =>
  Effect.runPromise(
    ingestRecorderEvent(testDb as never, event, askEditor).pipe(
      Effect.provide(
        JobOperationsService.Default.pipe(
          Layer.provide(Layer.succeed(DrizzleService, testDb as never))
        )
      )
    )
  );

/** Where a Stream Deck Record's Recording Sessions go. */
export const STREAM_DECK_FOLDER = fs.mkdtempSync(
  path.join(os.tmpdir(), "recorder-client-deck-")
);
afterAll(() => fs.rmSync(STREAM_DECK_FOLDER, { recursive: true, force: true }));

export type LastPassed = RecorderClientOptions["calibration"];

/**
 * A fresh AV Calibration on the scripted mic, stored (a Recording Session
 * links it): every Record is let through.
 */
export const freshCalibration: LastPassed = async () => {
  await testDb
    .insert(avCalibrations)
    .values({
      id: CALIBRATION.id,
      createdAt: new Date(CALIBRATION.createdAtMs),
      outcome: "passed",
      noiseFloorDb: -80,
      speechLufs: -27,
      truePeakDb: -10,
      thresholdDb: CALIBRATION.thresholdDb,
      recorderMic: CALIBRATION.recorderMic,
      scriptVersion: 3,
      micFilePath: "/calibrations/ok/mic.wav",
      scriptFilePath: "/calibrations/ok/calibration-script.json",
      cameraDevice: "Cam Link 4K",
      clapsFound: 5,
      clapSpreadMs: 8,
      micOffsetMs: 142,
      cameraFilePath: "/calibrations/ok/camera.mkv",
    })
    .onConflictDoNothing();
  return CALIBRATION;
};

/**
 * {@link freshCalibration}, with a way to wait for its latest read. The client
 * prepares the recorder for a Stream Deck Record only once the read is done:
 * close the client before then and the Stream Deck has nothing to record with.
 */
export const trackedCalibration = () => {
  let latest: Promise<unknown> = Promise.resolve();
  return {
    read: (() => {
      const read = freshCalibration();
      latest = read;
      return read;
    }) satisfies LastPassed,
    settled: () => latest,
  };
};

/** The latest calibration passed under today's rules, from the test database, as the app reads it. */
export const calibrationFromDatabase: LastPassed = () =>
  Effect.runPromise(lastPassedCalibration(testDb as never));

/** The app server's recorder client, as live.server.ts makes it. */
export const connectClient = (
  port: number,
  ingest: Ingest = saveEvent,
  lastPassed: LastPassed = freshCalibration,
  keepWhisperWarm?: (ms: number) => void,
  more: Partial<
    Pick<
      RecorderClientOptions,
      "launcher" | "idleMs" | "onLiveStreamChanged" | "onStreamedSessionEnded"
    >
  > = {}
) => {
  const client = createRecorderClient({
    onLiveStreamChanged: () => {},
    onStreamedSessionEnded: () => {},
    ...more,
    keepWhisperWarm,
    url: `ws://127.0.0.1:${port}`,
    ingest,
    unfinishedRecordingSessions: (candidates) =>
      Effect.runPromise(
        unfinishedRecordingSessions(testDb as never, candidates)
      ),
    calibration: lastPassed,
    reconnectMs: 50,
    commandTimeoutMs: 5_000,
    closeGraceMs: 50,
    retryMs: 20,
    // A listener here never answers `speech-ended` unless its test does.
    placeTimeoutMs: 30,
    folder: STREAM_DECK_FOLDER,
  });
  clients.push(client);
  return client;
};

export type TestRecorderClient = ReturnType<typeof connectClient>;

/** The recorder service on a scripted Windows, and an app server's client connected to it. */
export const startServiceAndClient = async (
  ingest?: Ingest,
  lastPassed?: LastPassed
) => {
  const { windows, port, stateDir } = await startService();
  return {
    windows,
    client: connectClient(port, ingest, lastPassed),
    port,
    stateDir,
  };
};

export const readSession = () => testDb.query.recordingSessions.findFirst();

/** Records on a new CVM recorder Video, the insertion point at its start. */
export const recordOn = async (client: TestRecorderClient) => {
  const video = await clipService.createVideo("CVM recorder");
  client.subscribe(video.id, () => {});
  await vi.waitFor(() =>
    client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    })
  );
  return video;
};

/** The camera's speech detector hears speech over each [from, to]. */
export const speak = (
  camera: { stderr: (text: string) => void },
  ...takes: [number, number][]
) => {
  for (const [from, to] of takes) {
    camera.stderr(
      `[silencedetect @ 1] silence_end: ${from} | silence_duration: 1\r\n`
    );
    camera.stderr(`[silencedetect @ 1] silence_start: ${to}\r\n`);
  }
};

export const clipTimes = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((i) =>
    i.type === "clip" ? [[i.data.sourceStartTime, i.data.sourceEndTime]] : []
  );

/**
 * The camera writer as it runs over a synthetic mic: sound over each
 * [from, to] (`to` may run past `until`), silence between. Its file time
 * advances in 0.05 s progress blocks up to `until`, and silencedetect
 * speaks as the real one does: a silence's `silence_start` (its start) once
 * it has lasted `silenceSeconds`, and its `silence_end` as the sound
 * returns. A quiet gap shorter than `silenceSeconds` is no silence at all.
 * The file opens in silence.
 */
export const film = (
  camera: {
    stderr: (text: string) => void;
    stdout: (text: string) => void;
  },
  o: { silenceSeconds: number; sound: [number, number][]; until: number }
) => {
  const lines: { at: number; line: string }[] = [];
  const silence = (from: number, to: number) => {
    if (to - from < o.silenceSeconds) return;
    lines.push({
      at: from + o.silenceSeconds,
      line: `[silencedetect @ 1] silence_start: ${from === 0 ? -0.0001 : from}\r\n`,
    });
    if (to <= o.until)
      lines.push({
        at: to,
        line: `[silencedetect @ 1] silence_end: ${to} | silence_duration: ${to - from}\r\n`,
      });
  };
  let quietFrom = 0;
  for (const [from, to] of o.sound) {
    silence(quietFrom, from);
    quietFrom = to;
  }
  silence(quietFrom, Infinity);
  lines.sort((a, b) => a.at - b.at);
  const blocks = Math.round(o.until / 0.05);
  for (let i = 0; i <= blocks; i++) {
    const t = Math.round(i * 0.05 * 1000) / 1000;
    while (lines.length > 0 && lines[0]!.at <= t)
      camera.stderr(lines.shift()!.line);
    camera.stdout(
      `frame=${i + 1}\nout_time_us=${Math.round(t * 1e6)}\nprogress=continue\n`
    );
  }
};

/**
 * Stands between the recorder client and the service, so a test can cut the
 * connection (and keep it cut) without either end closing. Records the
 * commands the client sends.
 */
export const startLink = async (servicePort: number) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const sent: RecorderCommand[] = [];
  let up = true;
  const pairs = new Set<[WebSocket, WebSocket]>();
  server.on("connection", (client) => {
    if (!up) return client.terminate();
    const service = new WebSocket(`ws://127.0.0.1:${servicePort}`);
    const pair: [WebSocket, WebSocket] = [client, service];
    pairs.add(pair);
    const queued: string[] = [];
    service.on("open", () => queued.splice(0).forEach((m) => service.send(m)));
    service.on("message", (data) => client.send(String(data)));
    client.on("message", (data) => {
      sent.push(JSON.parse(String(data)) as RecorderCommand);
      if (service.readyState === WebSocket.OPEN) service.send(String(data));
      else queued.push(String(data));
    });
    const end = () => {
      pairs.delete(pair);
      client.terminate();
      service.terminate();
    };
    client.on("close", end);
    service.on("close", end);
  });
  const { port } = server.address() as { port: number };
  return {
    port,
    sent,
    cut: () => {
      up = false;
      for (const [client] of pairs) client.terminate();
    },
    restore: () => {
      up = true;
    },
    close: () => {
      for (const [client, service] of pairs) {
        client.terminate();
        service.terminate();
      }
      server.close();
    },
  };
};
