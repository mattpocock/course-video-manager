import fs from "node:fs";
import type { LastPassedCalibration } from "../../app/av-calibration-constants";
import type {
  RecorderMessage,
  RecordingSessionEvent,
  RecordingSessionFiles,
} from "../../recorder-service/protocol";
import {
  isLive,
  isState,
  watchFeed,
  type Client,
  type FeedWatch,
  type Received,
  type ServiceProcess,
} from "./service-control";
import type { PreviewProbe } from "./preview-probe";
import { windowsClockOffset } from "./windows";
import type { Measured } from "./metrics";

/**
 * A RUN'S CONTEXT AND ONE TAKE: opening the recorder as the editor does,
 * and a Record/Stop with everything the scorecard times around it.
 */

/** The run stops: Matt started filming, or a Windows process left Idle. */
export class Aborted extends Error {}

export type Ctx = {
  marker: string;
  stateDir: string;
  footageDir: string;
  /** Where the report goes: logs a scenario keeps go beside it. */
  outDir: string;
  /** The service's own log (its Live Stream lines among it). */
  serviceLog: string;
  videoId: string;
  calibration: LastPassedCalibration;
  service: ServiceProcess;
  client: Client;
  feeds: { camera: FeedWatch; screen: FeedWatch };
  probe: PreviewProbe | undefined;
  cpus: number;
  measured: Measured;
  details: Record<string, unknown>;
  log: (line: string) => void;
  /** Throws once the run must stop (Matt's own recorder started recording). */
  checkAbort: () => void;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits `ms`, checking for an abort every second. */
export const hold = async (ctx: Ctx, ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    ctx.checkAbort();
    await sleep(Math.min(1000, end - performance.now()));
  }
};

/** Opens the recorder for the run's Video and says what Record records with, as the editor does. */
export const openRecorder = async (ctx: Ctx) => {
  const from = ctx.client.send({
    type: "open",
    videoId: ctx.videoId,
    format: "landscape",
  });
  const live = await ctx.client.waitFor(isLive, {
    from: from.from,
    timeoutMs: 60_000,
    what: "the camera to go live",
  });
  ctx.client.send({
    type: "prepare-record",
    videoId: ctx.videoId,
    silenceLength: "short",
    folder: ctx.footageDir,
    calibration: ctx.calibration,
  });
  return live.at - from.at;
};

/** The feeds, watched afresh (a service started again has a new port). */
export const watchFeeds = (port: number) => ({
  camera: watchFeed(port, "camera"),
  screen: watchFeed(port, "screen"),
});

export const rssMb = (pid: number | undefined) => {
  try {
    const kb = fs
      .readFileSync(`/proc/${pid}/status`, "utf8")
      .match(/VmRSS:\s+(\d+)/)?.[1];
    return kb ? Number(kb) / 1024 : NaN;
  } catch {
    return NaN;
  }
};

type Started = Extract<RecordingSessionEvent, { type: "recording-started" }>;
type Stopped = Extract<RecordingSessionEvent, { type: "recording-stopped" }>;

export type Take = {
  id: string;
  t0Ms: number;
  files: RecordingSessionFiles;
  /** Windows - WSL clock offset, ms, read just before Record. */
  offsetMs: number;
  /** Record pressed: `performance.now()` and Windows ms. */
  pressAt: number;
  pressWin: number;
  ackMs: number;
  stopAt: number;
  /** Stop pressed, Windows ms. */
  stopWin: number;
  stopToOpenMs: number;
  stopToNextCommandMs: number;
  stopToFinalMs: number;
  stopped: Stopped;
  /** Every message the take brought, Record to stopped. */
  messages: Received[];
};

/**
 * Record, then `during(take)` while it records, then Stop. Stop is followed
 * at once by a `replay` (a command that answers only once the queue reaches
 * it) to time when the recorder answers again.
 */
export const recordTake = async (
  ctx: Ctx,
  during: (t: {
    pressAt: number;
    t0Ms: number;
    id: string;
    files: RecordingSessionFiles;
  }) => Promise<void>,
  o: { stopTimeoutMs?: number; expectStop?: boolean } = {}
): Promise<Take> => {
  ctx.checkAbort();
  const offsetMs = await windowsClockOffset();
  const press = ctx.client.send({
    type: "record",
    silenceLength: "short",
    folder: ctx.footageDir,
    calibration: ctx.calibration,
  });
  const pressWin = press.wall + offsetMs;
  const refused = ctx.client
    .waitFor((m) => m.type === "refused", {
      from: press.from,
      timeoutMs: 20_000,
    })
    .then(
      (r) => r,
      () => undefined
    );
  const ack = await Promise.race([
    ctx.client.waitFor(isState("recording"), {
      from: press.from,
      timeoutMs: 20_000,
      what: "recording",
    }),
    refused.then((r) => {
      if (r) throw new Error(`Record refused: ${JSON.stringify(r.message)}`);
      return new Promise<never>(() => {});
    }),
  ]);
  const started = (
    await ctx.client.waitFor((m) => m.type === "recording-started", {
      from: press.from,
      what: "recording-started",
    })
  ).message as Started;
  const isStopped = (m: RecorderMessage) =>
    m.type === "recording-stopped" &&
    m.recordingSessionId === started.recordingSessionId;
  await during({
    pressAt: press.at,
    t0Ms: started.t0Ms,
    id: started.recordingSessionId,
    files: started.files,
  });
  // A take the scenario ended itself (a fault) has already stopped.
  let stop = {
    from: ctx.client.received.length,
    at: performance.now(),
    wall: Date.now(),
  };
  if (o.expectStop !== true) {
    stop = ctx.client.send({ type: "stop" });
    ctx.client.send({
      type: "replay",
      recordingSessionId: started.recordingSessionId,
      afterSeq: Number.MAX_SAFE_INTEGER,
    });
  }
  const stoppedAt = await ctx.client.waitFor(isStopped, {
    // From Record: a take that ended on its own before Stop is still found.
    from: press.from,
    timeoutMs: o.stopTimeoutMs ?? 60_000,
    what: "recording-stopped",
  });
  // The first open since Record: the recorder opens again at Stop (#2211),
  // before the take's files are final, or when a take ends by itself.
  const open = await ctx.client.waitFor(isState("open"), {
    from: press.from,
    timeoutMs: 60_000,
    what: "open after stop",
  });
  const next = o.expectStop
    ? open
    : await ctx.client.waitFor((m) => m.type === "replay-done", {
        from: stop.from,
        what: "replay-done",
      });
  return {
    id: started.recordingSessionId,
    t0Ms: started.t0Ms,
    files: started.files,
    offsetMs,
    pressAt: press.at,
    pressWin,
    ackMs: ack.at - press.at,
    stopAt: stop.at,
    stopWin: stop.wall + offsetMs,
    stopToOpenMs: Math.max(0, open.at - stop.at),
    stopToNextCommandMs: next.at - stop.at,
    stopToFinalMs: stoppedAt.at - stop.at,
    stopped: stoppedAt.message as Stopped,
    messages: ctx.client.received.slice(press.from),
  };
};

const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null;

/**
 * How long after the moment the rule was met each speech event reached the
 * client: `take-started` (the Optimistic Clip appears) is due once speech
 * has run the minimum Clip length and a Silence Length; `speech-ended` once
 * a Silence Length of silence has passed.
 */
export const speechDelays = (take: Take, silenceSeconds: number) => {
  const win = (r: Received) => r.wall + take.offsetMs;
  const fileWin = (t: number) => take.t0Ms + t * 1000;
  const optimistic: number[] = [];
  const clipEnd: number[] = [];
  let speechStart: number | undefined;
  for (const r of take.messages) {
    // The speech Stop cuts off ends at Stop, not on silence.
    if (r.at >= take.stopAt) break;
    const m = r.message;
    if (m.type === "speech-started") speechStart = m.fileTime;
    if (m.type === "take-started" && speechStart !== undefined)
      optimistic.push(win(r) - fileWin(speechStart + 1 + silenceSeconds));
    if (m.type === "speech-ended" && m.recordingSessionId === take.id)
      clipEnd.push(win(r) - fileWin(m.fileTime + silenceSeconds));
  }
  return {
    optimisticMs: median(optimistic),
    clipEndMs: median(clipEnd),
    optimisticAll: optimistic.map(Math.round),
    clipEndAll: clipEnd.map(Math.round),
  };
};
