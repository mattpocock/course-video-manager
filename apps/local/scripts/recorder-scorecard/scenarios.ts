import fs from "node:fs";
import { PREVIEW_TAGS } from "../../recorder-service/capture-args";
import { SILENCE_LENGTH_SHORT_SECONDS } from "../../app/silence-detection-constants";
import {
  analyseMic,
  analysePicture,
  decodeStamps,
  isPlayable,
  playable,
} from "./footage-analysis";
import { CAMERA_FPS, SCREEN_FPS } from "./synthetic-sources";
import {
  Aborted,
  hold,
  recordTake,
  rssMb,
  sleep,
  speechDelays,
  type Ctx,
} from "./takes";
import {
  cpuBetween,
  killMarked,
  sampleGpu,
  sampleMarked,
  windowsClockOffset,
  type GpuReading,
} from "./windows";

/**
 * THE SCENARIOS, each filling its metrics into `ctx.measured` and what it
 * saw into `ctx.details`.
 */

const LATENCY_WINDOW_MS = 10_000;

/** The recorder open and idle: preview latency, CPU, memory, GPU. */
export const idle = async (ctx: Ctx, gpuBefore: GpuReading | null) => {
  ctx.log("idle: preview latency and resources, recorder open, no take");
  const offset = await windowsClockOffset();
  await ctx.probe?.reset("camera", offset);
  await ctx.probe?.reset("screen", offset);
  const gpu = sampleGpu(LATENCY_WINDOW_MS);
  const a = await sampleMarked(ctx.marker);
  await hold(ctx, LATENCY_WINDOW_MS);
  const b = await sampleMarked(ctx.marker);
  const gpuIdle = await gpu;
  const cam = (await ctx.probe?.read("camera")) ?? null;
  const scr = (await ctx.probe?.read("screen")) ?? null;
  const cpu = cpuBetween(a, b, ctx.cpus);
  ctx.measured.preview_camera_idle_p50_ms = cam?.medianMs ?? null;
  ctx.measured.preview_screen_idle_p50_ms = scr?.medianMs ?? null;
  ctx.measured.cpu_idle_pct = cpu.cpuPctOfMachine;
  ctx.details.idle = {
    previewCamera: cam,
    previewScreen: scr,
    cpu,
    gpuBefore,
    gpuIdle,
    serviceRssMb: rssMb(ctx.service.child.pid),
  };
};

/**
 * THE LONG TAKE: Record, preview latency during the take, resources, then
 * Stop; the files read back for first frames, repeats, drops and drift.
 */
export const longTake = async (
  ctx: Ctx,
  seconds: number,
  gpuBefore: GpuReading | null
) => {
  ctx.log(`long take: ${seconds} s`);
  await sleep(2000);
  const gpu = sampleGpu(seconds * 1000);
  let cpu: ReturnType<typeof cpuBetween> | undefined;
  let rss = NaN;
  let latency: Record<string, unknown> = {};
  const take = await recordTake(ctx, async () => {
    await hold(ctx, 1500);
    const offset = await windowsClockOffset();
    await ctx.probe?.reset("camera", offset);
    await ctx.probe?.reset("screen", offset);
    const a = await sampleMarked(ctx.marker);
    await hold(ctx, LATENCY_WINDOW_MS);
    const cam = (await ctx.probe?.read("camera")) ?? null;
    const scr = (await ctx.probe?.read("screen")) ?? null;
    latency = { camera: cam, screen: scr };
    ctx.measured.preview_camera_take_p50_ms = cam?.medianMs ?? null;
    ctx.measured.preview_camera_take_p95_ms = cam?.p95Ms ?? null;
    ctx.measured.preview_screen_take_p50_ms = scr?.medianMs ?? null;
    ctx.measured.preview_screen_take_p95_ms = scr?.p95Ms ?? null;
    await hold(ctx, Math.max(0, seconds * 1000 - 13_000));
    const b = await sampleMarked(ctx.marker);
    cpu = cpuBetween(a, b, ctx.cpus);
    rss = rssMb(ctx.service.child.pid);
  });
  const gpuRec = await gpu;
  const m = ctx.measured;
  m.record_ack_ms = take.ackMs;
  m.stop_to_open_ms = take.stopToOpenMs;
  m.stop_to_next_command_ms = take.stopToNextCommandMs;
  m.stop_to_files_final_ms = take.stopToFinalMs;
  m.preview_gap_on_record_ms = ctx.feeds.camera.longestGap(
    take.pressAt - 500,
    take.pressAt + 2500
  );
  m.screen_preview_gap_on_record_ms = ctx.feeds.screen.longestGap(
    take.pressAt - 500,
    take.pressAt + 2500
  );
  await sleep(2500);
  m.preview_gap_on_stop_ms = ctx.feeds.camera.longestGap(
    take.stopAt - 500,
    take.stopAt + 2500
  );
  if (cpu) {
    m.cpu_recording_pct = cpu.cpuPctOfMachine;
    m.memory_recording_mb = cpu.workingSetMb + rss;
  }
  if (gpuRec && gpuBefore) {
    m.gpu_recording_delta_pct = gpuRec.gpuPct - gpuBefore.gpuPct;
    m.nvenc_recording_delta_pct = gpuRec.encoderPct - gpuBefore.encoderPct;
    m.vram_recording_delta_mb = gpuRec.memoryMb - gpuBefore.memoryMb;
  }
  const speech = speechDelays(take, SILENCE_LENGTH_SHORT_SECONDS);
  m.optimistic_clip_delay_ms = speech.optimisticMs;
  m.clip_end_delay_ms = speech.clipEndMs;
  m.service_frames_lost = take.stopped.framesLost.camera;
  m.service_screen_frames_lost = take.stopped.framesLost.screen;

  ctx.log("long take: reading the files back");
  const camera = analysePicture(await decodeStamps(take.files.camera), {
    fps: CAMERA_FPS,
    t0Ms: take.t0Ms,
  });
  const screen = analysePicture(await decodeStamps(take.files.screen), {
    fps: SCREEN_FPS,
    t0Ms: take.t0Ms,
  });
  const mic = analyseMic(take.files.mic);
  m.record_to_first_camera_frame_ms = camera.firstCaptureMs - take.pressWin;
  m.record_to_first_screen_frame_ms = screen.firstCaptureMs - take.pressWin;
  m.record_to_first_mic_ms =
    take.t0Ms + mic.firstSoundSeconds * 1000 - take.pressWin;
  m.camera_dropped_frames = camera.dropped;
  m.camera_repeated_per_100 =
    (camera.repeated / Math.max(1, camera.frames)) * 100;
  m.screen_dropped_frames = screen.dropped;
  m.screen_repeated_per_100 =
    (screen.repeated / Math.max(1, screen.frames)) * 100;
  const micDrift = mic.driftEndMs - mic.driftStartMs;
  const camDrift = camera.lagEndMs - camera.lagStartMs;
  m.av_drift_ms = Math.abs(micDrift - camDrift);
  m.screen_lag_drift_ms = Math.abs(screen.lagEndMs - screen.lagStartMs);
  ctx.details.longTake = {
    seconds,
    recordingSessionId: take.id,
    pressToT0Ms: take.t0Ms - take.pressWin,
    stopped: {
      reason: take.stopped.reason,
      exitCodes: take.stopped.exitCodes,
      framesLost: take.stopped.framesLost,
      errors: take.stopped.errors,
    },
    camera,
    screen,
    mic: { ...mic, onsets: mic.onsets.length },
    micDriftMs: micDrift,
    cameraLagDriftMs: camDrift,
    speech,
    latency,
    cpu,
    serviceRssMb: rss,
    gpuRecording: gpuRec,
  };
};

/** One take whose camera preview, then screen preview, is killed mid-take. */
const previewKillTrial = async (ctx: Ctx, seconds: number) => {
  let killAt = 0;
  let screenKillAt = 0;
  let killed = 0;
  const take = await recordTake(ctx, async () => {
    await hold(ctx, 3000);
    killAt = performance.now();
    killed += await killMarked(ctx.marker, [PREVIEW_TAGS.camera]);
    await hold(ctx, 4000);
    screenKillAt = performance.now();
    killed += await killMarked(ctx.marker, [PREVIEW_TAGS.screen]);
    await hold(ctx, Math.max(3000, seconds * 1000 - 9000));
  });
  const camera = analysePicture(await decodeStamps(take.files.camera), {
    fps: CAMERA_FPS,
    t0Ms: take.t0Ms,
  });
  const stoppedCleanly =
    take.stopped.reason === "requested" &&
    take.stopped.exitCodes.camera === 0 &&
    take.stopped.exitCodes.screen === 0;
  // A take that ended by itself lost everything from its end to Stop.
  const tailLost = Math.max(
    0,
    Math.round(
      ((take.stopWin - take.t0Ms) / 1000 - take.stopped.fileTime) * CAMERA_FPS
    )
  );
  const framesLost =
    camera.dropped + camera.repeated + (stoppedCleanly ? 0 : tailLost);
  return {
    pass: stoppedCleanly && killed >= 2 && framesLost === 0,
    processesKilled: killed,
    framesLost,
    camera,
    serviceFramesLost: take.stopped.framesLost,
    recoveryMs: ctx.feeds.camera.longestGap(killAt, killAt + 4000),
    screenPreviewGapMs: ctx.feeds.screen.longestGap(
      screenKillAt,
      screenKillAt + 4000
    ),
    takeEndedAtSeconds: take.stopped.fileTime,
    stopPressedAtSeconds: (take.stopWin - take.t0Ms) / 1000,
    stopped: {
      reason: take.stopped.reason,
      exitCodes: take.stopped.exitCodes,
      errors: take.stopped.errors,
    },
  };
};

/**
 * PREVIEW KILLED → RECORDING UNAFFECTED, `n` times: the pass rate is what the
 * ratchet hardens (the real-ffmpeg isolation tests flake under load, so CI
 * skips them; here every process runs at Idle on cores 6-9, a load that is
 * the same every run).
 */
export const previewKill = async (ctx: Ctx, seconds: number, n: number) => {
  ctx.log(
    `preview kill: ${n} takes, camera and screen previews killed mid-take`
  );
  const trials: Awaited<ReturnType<typeof previewKillTrial>>[] = [];
  const errors: string[] = [];
  for (let i = 0; i < n; i++) {
    ctx.checkAbort();
    await sleep(2000);
    try {
      trials.push(await previewKillTrial(ctx, seconds));
    } catch (e) {
      if (e instanceof Aborted) throw e;
      errors.push(e instanceof Error ? e.message.slice(0, 500) : String(e));
      ctx.client.send({ type: "stop" });
      await sleep(3000);
    }
  }
  const passed = trials.filter((t) => t.pass).length;
  const recoveries = trials.map((t) => t.recoveryMs).sort((a, b) => a - b);
  ctx.measured.preview_kill_pass_rate_pct = n ? (passed / n) * 100 : null;
  ctx.measured.preview_kill_take_frames_lost = trials.length
    ? Math.max(...trials.map((t) => t.framesLost))
    : null;
  ctx.measured.preview_kill_take_ok =
    trials.length === n && passed === n ? 1 : 0;
  ctx.measured.preview_kill_recovery_ms = recoveries.length
    ? recoveries[Math.floor(recoveries.length / 2)]!
    : null;
  ctx.details.previewKill = { n, passed, trials, errors };
};

/** The event log stops being writable mid-take (a disk fault the scorecard can make safely). */
export const eventLogFailure = async (ctx: Ctx) => {
  ctx.log("event log failure: events.jsonl made read-only mid-take");
  await sleep(2000);
  let eventLog = "";
  const take = await recordTake(
    ctx,
    async ({ files, id }) => {
      eventLog = files.camera.replace(/camera\.mkv$/, "events.jsonl");
      await hold(ctx, 2000);
      fs.chmodSync(eventLog, 0o444);
      const stopped = await ctx.client
        .waitFor(
          (m) => m.type === "recording-stopped" && m.recordingSessionId === id,
          { timeoutMs: 20_000, what: "the take to stop on the failed write" }
        )
        .catch(() => undefined);
      // It went on recording: stop it, and it scores as not stopping.
      if (!stopped) ctx.client.send({ type: "stop" });
    },
    { expectStop: true }
  ).finally(() => {
    if (eventLog) fs.chmodSync(eventLog, 0o644);
  });
  const files = [take.files.camera, take.files.screen, take.files.mic].map(
    playable
  );
  ctx.measured.event_log_failure_stops_cleanly =
    take.stopped.reason === "event-log-failed" && files.every(isPlayable)
      ? 1
      : 0;
  ctx.details.eventLogFailure = {
    reason: take.stopped.reason,
    errors: take.stopped.errors,
    files,
  };
};
