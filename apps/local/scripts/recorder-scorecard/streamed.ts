import { execFileSync } from "node:child_process";
import path from "node:path";
import { DEFAULT_MIC_EQ } from "@cvm/core/features/videos/recorder";
import type { RecorderMessage } from "../../recorder-service/protocol";
import { findFfmpegExe } from "../../recorder-service/windows-launcher";
import { analysePicture, decodeStamps } from "./footage-analysis";
import { isState, type Received } from "./service-control";
import type { ProgressSample, Span } from "./stream-sink";
import {
  readProgress,
  SCORECARD_STREAM_KEY,
  sinkArgs,
  streamLag,
  takeDupsDrops,
  takeFps,
} from "./stream-sink";
import { CAMERA_FPS, SCREEN_FPS } from "./synthetic-sources";
import { relaunchedBetween, streamFaults, type Sinks } from "./stream-faults";
import { hold, sleep, type Ctx } from "./takes";
import { killMarked, windowsGuard } from "./windows";

/**
 * THE STREAMED RECORDING SESSION (#2455): Go Live on the real service and
 * real ffmpeg.exe, the Live Stream pushed to a local RTMP sink (never
 * YouTube, with a fake Stream Key), for `seconds`, then End Stream. Raw
 * footage first: the take's camera and screen framesLost; then the
 * stream's own picture over the whole take: duplicated and dropped frames,
 * and its average frames per second of wall time, with its lag reported. Mid-take the sink drops and comes back, then the stream
 * process is killed (`stream-faults.ts`, #2459): the Live Stream must come
 * back on its own each time, and the take must not notice.
 *
 * `during` runs while the Live Stream is live (#2461's Chat Highlight
 * clicks, `card-checks.ts`); what it returns runs once End Stream is done
 * and the sink has closed its copy of the stream (`sinkFile`).
 */

/** Frames after it goes live that the rate leaves out: its encoder settling. */
const WARM_UP_MS = 5_000;

/**
 * The first stream process's steady state starts later (#2482). It listens
 * before Record, and its feeds queue while it opens them and CUDA, so it
 * goes live 0.5–1 s behind. It drains that with whatever headroom it has
 * over 60 fps, which took about 20 s once the card was drawn on the CPU
 * (#2462). A relaunch's picture starts ahead of its feeds, with nothing to
 * drain.
 */
const FIRST_WARM_UP_MS = 20_000;

const streamOf = (m: RecorderMessage) =>
  m.type === "state" && m.state.kind !== "closed" ? m.state.stream : undefined;

/** What the sink carries in its command line, beside the run's marker. */
const SINK_TAG = "cvm-scorecard-sink";

/** The sink: a Windows ffmpeg.exe that takes the push and counts its frames. */
const startSink = (ctx: Ctx, port: number, file: string) => {
  const exe = findFfmpegExe();
  if (!exe) throw new Error("ffmpeg.exe not found for the stream sink");
  const winFile = execFileSync("wslpath", ["-w", file], {
    encoding: "utf8",
  }).trim();
  const child = windowsGuard().spawn(exe, sinkArgs(port, ctx.marker, winFile), {
    cwd: "/mnt/c",
  });
  const progress = readProgress();
  let stderr = "";
  child.stdout?.on("data", (d: Buffer) =>
    progress.push(d.toString(), performance.now())
  );
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  child.stdin?.on("error", () => {});
  const exited = new Promise<void>((r) => {
    child.once("close", () => r());
    child.once("error", () => r());
  });
  return {
    frames: () => progress.samples.at(-1)?.frame ?? 0,
    stderr: () => stderr,
    /** Gone by itself once the push ends, or killed after `ms`. */
    close: async (ms: number) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, ms);
      await exited;
      clearTimeout(timer);
    },
  };
};

/** Go Live, as the app server sends it, with the fake key: the take, and once it is live. */
const goLive = async (ctx: Ctx) => {
  const go = ctx.client.send({
    type: "start-stream",
    broadcastId: "scorecard-broadcast",
    streamKey: SCORECARD_STREAM_KEY,
    micOffsetMs: 0,
    micEq: DEFAULT_MIC_EQ,
    record: {
      silenceLength: "short",
      folder: ctx.footageDir,
      calibration: ctx.calibration,
    },
  });
  const answer = await ctx.client.waitFor(
    (m) => m.type === "recording-started" || m.type === "refused",
    { from: go.from, timeoutMs: 60_000, what: "Go Live to record" }
  );
  if (answer.message.type !== "recording-started")
    throw new Error(`Go Live refused: ${JSON.stringify(answer.message)}`);
  const live = await ctx.client
    .waitFor((m) => streamOf(m)?.kind === "live", {
      from: go.from,
      timeoutMs: 30_000,
      what: "the Live Stream to go live",
    })
    .catch(() => undefined);
  return { go, answer, started: answer.message, live };
};

type Stopped = Extract<RecorderMessage, { type: "recording-stopped" }>;

/**
 * Raw footage first: the service's framesLost, plus every frame from the
 * take's end to End Stream when it ended before End Stream.
 */
const footageLost = (
  s: Stopped,
  endedEarly: boolean,
  recordedSeconds: number
) => {
  const tail = endedEarly ? Math.max(0, recordedSeconds - s.fileTime) : 0;
  return {
    camera: s.framesLost.camera + Math.round(tail * CAMERA_FPS),
    // No screen count means no screen recorder: unmeasured, never a pass.
    screen:
      s.framesLost.screen === null
        ? null
        : s.framesLost.screen + Math.round(tail * SCREEN_FPS),
  };
};

const offSixty = (fps: number | null) =>
  fps === null ? null : Math.abs(fps - 60);

/**
 * The whole take's picture (decided 2026-10-31): every process's dups and
 * drops, and the average rate over each process once it is steady, the
 * sink's drop and return included. The first process's lag behind the take
 * is reported, not a bar. Nothing but the relaunch is measured when the
 * first process never went live.
 */
const takePicture = (
  samples: readonly ProgressSample[],
  at: {
    liveAt: number | null;
    killAt: number;
    relaunchedLiveAt: number | null;
    endAt: number;
    t0Ms: number;
  }
) => {
  const pushed = samples.filter((p) => p.at <= at.endAt);
  const relaunched: Span | null =
    at.relaunchedLiveAt === null
      ? null
      : [at.relaunchedLiveAt + WARM_UP_MS, at.endAt];
  const relaunchedFps = relaunched && takeFps(pushed, [relaunched]);
  // Its offset holds the relaunch's own start in file time: read its shape.
  const relaunchedLag = relaunched && streamLag(pushed, relaunched, at.t0Ms);
  if (at.liveAt === null)
    return {
      fps: null,
      relaunchedFps,
      relaunchedLag,
      dupFrames: null,
      dropFrames: null,
      lag: null,
      ffmpegFps: null,
      encodedFrames: null,
    };
  const first: Span = [at.liveAt + FIRST_WARM_UP_MS, at.killAt];
  return {
    fps: takeFps(pushed, relaunched ? [first, relaunched] : [first]),
    relaunchedFps,
    relaunchedLag,
    ...takeDupsDrops(pushed),
    lag: streamLag(pushed, first, at.t0Ms),
    ffmpegFps: pushed.at(-1)?.fps ?? null,
    encodedFrames: pushed.at(-1)?.frame ?? null,
  };
};

/** Every sink of the take, one after another on the same address. */
const sinksOn = (ctx: Ctx, port: number, file: (n: number) => string) => {
  const all = [startSink(ctx, port, file(1))];
  const sinks: Sinks = {
    current: () => all.at(-1)!,
    drop: async () => {
      await killMarked(ctx.marker, [SINK_TAG]);
      await all.at(-1)!.close(5_000);
    },
    restore: () => void all.push(startSink(ctx, port, file(all.length + 1))),
  };
  return {
    ...sinks,
    frames: () => all.map((s) => s.frames()),
    stderr: () => all.map((s) => s.stderr()),
    close: (ms: number) => Promise.all(all.map((s) => s.close(ms))),
  };
};

/** The Live Stream's health as the service sent it: how many, the first and the last few. */
const healthOf = (received: readonly Received[]) => {
  const all = received.flatMap((r) =>
    r.message.type === "stream-health" ? [r.message.health] : []
  );
  return { heard: all.length, first: all[0] ?? null, last: all.slice(-5) };
};

/** The Live Stream's statuses in order, each once. */
const statusesFrom = (received: readonly Received[]) =>
  received
    .map((r) => streamOf(r.message))
    .filter((x) => x !== undefined)
    .map((x) => (x.kind === "ended" ? `ended: ${x.reason}` : x.kind))
    .filter((x, i, a) => a[i - 1] !== x);

export const streamed = async (
  ctx: Ctx,
  seconds: number,
  sinkPort: number,
  during: (live: {
    liveAt: number;
    sinkFile: string;
    /** Whether the stream process was launched again between two `performance.now()`s. */
    relaunchedBetween: (from: number, to: number) => boolean;
  }) => Promise<() => Promise<void>> = async () => async () => {}
) => {
  ctx.log(`streamed: a ${seconds} s Live Stream, pushed to a local sink`);
  await sleep(2000);
  // Beside the footage, on WSL's disk: never a Windows drive.
  const sinkFile = (n: number) =>
    path.join(path.dirname(ctx.footageDir), `sink-${n}.flv`);
  const sink = sinksOn(ctx, sinkPort, sinkFile);
  const progress = readProgress();
  // A block the service could not stamp on the Windows clock is left out of its rate.
  const unwatch = ctx.service.onStreamProgress((chunk, windowsMs) =>
    progress.push(chunk, performance.now(), windowsMs ?? NaN)
  );
  try {
    const { go, answer, started, live } = await goLive(ctx);
    // The first sink's copy holds everything `during` did.
    const afterEnd = await during({
      liveAt: live?.at ?? NaN,
      sinkFile: sinkFile(1),
      relaunchedBetween: (from, to) =>
        relaunchedBetween(progress.samples, from, to),
    });
    const faults = await streamFaults(ctx, {
      goAt: go.at,
      seconds,
      sinks: sink,
      samples: progress.samples,
    });
    await hold(ctx, Math.max(0, seconds * 1000 - (performance.now() - go.at)));

    const end = ctx.client.send({ type: "end-stream" });
    const stopped = await ctx.client.waitFor(
      (m) =>
        m.type === "recording-stopped" &&
        m.recordingSessionId === started.recordingSessionId,
      { from: go.from, timeoutMs: 60_000, what: "recording-stopped" }
    );
    await ctx.client.waitFor(isState("open"), {
      from: end.from,
      timeoutMs: 60_000,
      what: "open after End Stream",
    });
    await sink.close(10_000);
    const s = stopped.message as Stopped;

    const endedEarly = stopped.at < end.at || s.reason !== "requested";
    const lost = footageLost(s, endedEarly, (end.wall - answer.wall) / 1000);
    const picture = takePicture(progress.samples, {
      liveAt: live?.at ?? null,
      killAt: faults.killAt,
      relaunchedLiveAt: faults.relaunchedLiveAt,
      endAt: end.at,
      t0Ms: started.t0Ms,
    });
    const fault = faults.result();
    const m = ctx.measured;
    m.streamed_camera_frames_lost = lost.camera;
    m.streamed_screen_frames_lost = lost.screen;
    m.stream_take_fps_off_60 = offSixty(picture.fps);
    m.stream_dup_frames = picture.dupFrames;
    m.stream_drop_frames = picture.dropFrames;
    m.stream_back_after_sink_drop = fault.backAfterSinkDrop ? 1 : 0;
    m.stream_back_after_kill = fault.backAfterKill ? 1 : 0;

    ctx.details.streamed = {
      seconds,
      recordingSessionId: started.recordingSessionId,
      goLiveToRecordingMs: answer.at - go.at,
      goLiveToStreamLiveMs: live ? live.at - go.at : null,
      streamStatuses: statusesFrom(ctx.client.received.slice(go.from)),
      streamFps: picture.fps,
      // The first process's lag behind the take, once steady, until the kill.
      streamLag: picture.lag,
      ffmpegFps: picture.ffmpegFps,
      encodedFrames: picture.encodedFrames,
      sinkFrames: sink.frames(),
      faults: {
        ...fault.details,
        // Reported, never a bar (2026-10-31): over its short span it reads lag wander.
        relaunchedFpsOff60: offSixty(picture.relaunchedFps),
        relaunchedFps: picture.relaunchedFps,
        relaunchedLag: picture.relaunchedLag,
      },
      health: healthOf(ctx.client.received.slice(go.from)),
      sinkStderr: sink.stderr(),
      endedBeforeEndStream: endedEarly,
      stopped: {
        reason: s.reason,
        fileTime: s.fileTime,
        exitCodes: s.exitCodes,
        framesLost: s.framesLost,
        lostFrameSpans: s.lostFrameSpans,
        errors: s.errors,
      },
      camera: analysePicture(await decodeStamps(started.files.camera), {
        fps: CAMERA_FPS,
        t0Ms: started.t0Ms,
      }),
      screen: analysePicture(await decodeStamps(started.files.screen), {
        fps: SCREEN_FPS,
        t0Ms: started.t0Ms,
      }),
    };
    await afterEnd();
    if (!live) throw new Error("The Live Stream never went live");
    if (sink.frames()[0] === 0)
      throw new Error("The local sink received no frame of the Live Stream");
  } finally {
    unwatch();
    await sink.close(0);
  }
};
