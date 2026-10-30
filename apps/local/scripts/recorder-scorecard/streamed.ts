import { DEFAULT_MIC_EQ } from "@cvm/core/features/videos/recorder";
import type { RecorderMessage } from "../../recorder-service/protocol";
import { findFfmpegExe } from "../../recorder-service/windows-launcher";
import { analysePicture, decodeStamps } from "./footage-analysis";
import { isState, type Received } from "./service-control";
import type { ProgressSample } from "./stream-sink";
import {
  readProgress,
  SCORECARD_STREAM_KEY,
  sinkArgs,
  streamRate,
} from "./stream-sink";
import { CAMERA_FPS, SCREEN_FPS } from "./synthetic-sources";
import { hold, sleep, type Ctx } from "./takes";
import { windowsGuard } from "./windows";

/**
 * THE STREAMED RECORDING SESSION (#2455): Go Live on the real service and
 * real ffmpeg.exe, the Live Stream pushed to a local RTMP sink (never
 * YouTube, with a fake Stream Key), for `seconds`, then End Stream. Raw
 * footage first: the take's camera and screen framesLost; then the
 * stream's own picture: frames per second of wall time, duplicated and
 * dropped frames.
 *
 * `during` runs while the Live Stream is live: #2461's Chat Highlight
 * checks (click-to-on-screen time, monotonic card opacity) go there.
 */

/** Frames after it goes live that the rate leaves out: its encoder settling. */
const WARM_UP_MS = 5_000;

const streamOf = (m: RecorderMessage) =>
  m.type === "state" && m.state.kind !== "closed" ? m.state.stream : undefined;

/** The sink: a Windows ffmpeg.exe that takes the push and counts its frames. */
const startSink = (ctx: Ctx, port: number) => {
  const exe = findFfmpegExe();
  if (!exe) throw new Error("ffmpeg.exe not found for the stream sink");
  const child = windowsGuard().spawn(exe, sinkArgs(port, ctx.marker), {
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

/** The stream's picture from its -progress, Go Live to End Stream. */
const streamPicture = (
  samples: readonly ProgressSample[],
  liveAt: number | undefined,
  endAt: number
) => {
  const pushed = samples.filter((p) => p.at <= endAt);
  const last = liveAt === undefined ? undefined : pushed.at(-1);
  const fps =
    liveAt === undefined ? null : streamRate(pushed, liveAt + WARM_UP_MS);
  return {
    fps,
    ffmpegFps: last?.fps ?? null,
    encodedFrames: last?.frame ?? null,
    dupFrames: last?.dupFrames ?? null,
    dropFrames: last?.dropFrames ?? null,
  };
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
  during: (live: { liveAt: number }) => Promise<void> = async () => {}
) => {
  ctx.log(`streamed: a ${seconds} s Live Stream, pushed to a local sink`);
  await sleep(2000);
  const sink = startSink(ctx, sinkPort);
  const progress = readProgress();
  const unwatch = ctx.service.onStreamProgress((chunk) =>
    progress.push(chunk, performance.now())
  );
  try {
    const { go, answer, started, live } = await goLive(ctx);
    await during({ liveAt: live?.at ?? NaN });
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
    const picture = streamPicture(progress.samples, live?.at, end.at);
    const m = ctx.measured;
    m.streamed_camera_frames_lost = lost.camera;
    m.streamed_screen_frames_lost = lost.screen;
    m.stream_fps_off_60 =
      picture.fps === null ? null : Math.abs(picture.fps - 60);
    m.stream_dup_frames = picture.dupFrames;
    m.stream_drop_frames = picture.dropFrames;

    ctx.details.streamed = {
      seconds,
      recordingSessionId: started.recordingSessionId,
      goLiveToRecordingMs: answer.at - go.at,
      goLiveToStreamLiveMs: live ? live.at - go.at : null,
      streamStatuses: statusesFrom(ctx.client.received.slice(go.from)),
      streamFps: picture.fps,
      ffmpegFps: picture.ffmpegFps,
      encodedFrames: picture.encodedFrames,
      sinkFrames: sink.frames(),
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
    if (!live) throw new Error("The Live Stream never went live");
    if (sink.frames() === 0)
      throw new Error("The local sink received no frame of the Live Stream");
  } finally {
    unwatch();
    await sink.close(0);
  }
};
