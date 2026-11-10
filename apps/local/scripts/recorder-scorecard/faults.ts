import { isPlayable, playable } from "./footage-analysis";
import { connect, startService } from "./service-control";
import {
  hold,
  openRecorder,
  recordTake,
  rssMb,
  sleep,
  watchFeeds,
  type Ctx,
} from "./takes";
import { CAPTURE_TAG } from "../../recorder-service/capture-args";
import type { RecorderMessage } from "../../recorder-service/protocol";
import {
  killMarked,
  runProcessesLeft,
  sampleMarked,
  windowsClockOffset,
} from "./windows";

/**
 * Back-to-back cycles, and the service killed mid-take.
 */

const percentile = (xs: number[], q: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** What the run's own processes hold: how many ffmpeg.exe, and memory with the service's. */
const footprint = async (ctx: Ctx) => {
  const s = await sampleMarked(ctx.marker);
  return {
    ffmpegProcesses: s.processes.length,
    memoryMb:
      s.processes.reduce((sum, p) => sum + p.workingSet, 0) / (1024 * 1024) +
      rssMb(ctx.service.child.pid),
  };
};

/** The camera capture's Windows PID now, if it runs. */
const capturePid = async (ctx: Ctx) =>
  (await sampleMarked(ctx.marker)).processes.find((p) => p.tag === CAPTURE_TAG)
    ?.pid;

/** A state saying the camera is being opened (again): the capture restarted. */
const reopening = (m: RecorderMessage) =>
  m.type === "state" &&
  m.state.kind === "open" &&
  m.state.camera.kind === "opening";

/**
 * `n` Record/Stop cycles, each a short take, with a short rest between.
 * Every Stop lets the writer go and the next is armed on the same relay: the
 * camera capture must live through it (same Windows PID, never reopened).
 */
export const cycles = async (ctx: Ctx, n: number) => {
  ctx.log(`cycles: ${n} back-to-back Record/Stop`);
  await sleep(2000);
  const before = await footprint(ctx);
  const acks: number[] = [];
  const finals: number[] = [];
  const recordGaps: number[] = [];
  const failures: string[] = [];
  let pid = await capturePid(ctx);
  const firstPid = pid;
  let restarts = 0;
  let survived = 0;
  let stops = 0;
  for (let i = 0; i < n; i++) {
    ctx.checkAbort();
    const from = ctx.client.received.length;
    try {
      const take = await recordTake(ctx, () => hold(ctx, 1000), {
        stopTimeoutMs: 30_000,
      });
      acks.push(take.ackMs);
      finals.push(take.stopToFinalMs);
      // The camera preview's longest gap around this Record, up to its Stop.
      recordGaps.push(
        ctx.feeds.camera.longestGap(
          take.pressAt - 500,
          Math.min(take.pressAt + 2500, take.stopAt)
        )
      );
      if (take.stopped.reason !== "requested")
        failures.push(`cycle ${i + 1}: stopped ${take.stopped.reason}`);
    } catch (e) {
      failures.push(
        `cycle ${i + 1}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`
      );
      await sleep(3000);
    }
    await sleep(1000);
    // The writer reconnect at this Stop: did the capture live through it?
    stops += 1;
    const now = await capturePid(ctx);
    const reopened = ctx.client.received
      .slice(from)
      .some((r) => reopening(r.message));
    if (now !== pid || reopened) restarts += 1;
    else survived += 1;
    pid = now;
  }
  await sleep(3000);
  const after = await footprint(ctx);
  ctx.measured.capture_restarts_per_stop = stops ? restarts / stops : null;
  ctx.measured.stop_capture_survival_pct = stops
    ? (survived / stops) * 100
    : null;
  ctx.measured.cycles_failed = failures.length;
  ctx.measured.cycles_leaked_processes = Math.max(
    0,
    after.ffmpegProcesses - before.ffmpegProcesses
  );
  ctx.measured.cycles_memory_growth_mb = after.memoryMb - before.memoryMb;
  ctx.measured.cycles_record_ack_p90_ms = percentile(acks, 0.9);
  ctx.measured.cycles_stop_final_p90_ms = percentile(finals, 0.9);
  ctx.measured.cycles_preview_gap_on_record_p50_ms = percentile(
    recordGaps,
    0.5
  );
  ctx.measured.cycles_preview_gap_on_record_p90_ms = percentile(
    recordGaps,
    0.9
  );
  ctx.details.cycles = {
    n,
    failures,
    captureRestarts: restarts,
    capturePids: { first: firstPid ?? null, last: pid ?? null },
    before,
    after,
    recordAckMs: {
      p50: percentile(acks, 0.5),
      p90: percentile(acks, 0.9),
      max: percentile(acks, 1),
    },
    stopToFinalMs: {
      p50: percentile(finals, 0.5),
      p90: percentile(finals, 0.9),
      max: percentile(finals, 1),
    },
    previewGapOnRecordMs: {
      p50: percentile(recordGaps, 0.5),
      p90: percentile(recordGaps, 0.9),
      max: percentile(recordGaps, 1),
      over100: recordGaps.filter((g) => g > 100).length,
    },
    firstTenAckMs: acks.slice(0, 10).map(Math.round),
    lastTenAckMs: acks.slice(-10).map(Math.round),
  };
};

/**
 * The service SIGKILLed mid-take, as a crash ends it, then started again on
 * the same state folder: it must stop what the dead one left running,
 * repair the files and report the Recording Session recovered.
 */
export const crash = async (ctx: Ctx) => {
  ctx.log("crash: the service killed mid-take, then started again");
  await sleep(2000);
  const offset = await windowsClockOffset();
  let killWin = 0;
  let take:
    | {
        id: string;
        t0Ms: number;
        files: { camera: string; screen: string; mic: string };
      }
    | undefined;
  await recordTake(ctx, async (t) => {
    take = t;
    await hold(ctx, 6000);
    killWin = Date.now() + offset;
    await ctx.service.kill();
    throw new Error("killed");
  }).catch((e: unknown) => {
    if (!(e instanceof Error && e.message === "killed")) throw e;
  });
  if (!take) throw new Error("The crash take never started");
  ctx.client.close();
  ctx.feeds.camera.close();
  ctx.feeds.screen.close();
  // A moment as a person takes to notice and restart `pnpm dev`.
  await sleep(2000);
  // The Windows guard refuses to start the service again while a recorder
  // ffmpeg.exe runs, the dead one's included: what still runs after 10 s is
  // stopped here, which pre-empts the restarted service's own stopTagged.
  let orphansStopped = 0;
  for (let i = 0; i < 10 && runProcessesLeft(ctx.marker); i++)
    await sleep(1000);
  if (runProcessesLeft(ctx.marker)) {
    orphansStopped = await killMarked(ctx.marker);
    for (let i = 0; i < 10 && runProcessesLeft(ctx.marker); i++)
      await sleep(1000);
  }
  const restartAt = performance.now();
  ctx.service = await startService({
    marker: ctx.marker,
    stateDir: ctx.stateDir,
    logFile: `${ctx.stateDir}/../service.log`,
  });
  ctx.client = await connect(ctx.service.port);
  ctx.feeds = watchFeeds(ctx.service.port);
  const hello = await ctx.client.waitFor((m) => m.type === "hello", {
    timeoutMs: 120_000,
    what: "hello after the restart",
  });
  const recovered =
    hello.message.type === "hello" && hello.message.recovered.includes(take.id);
  const files = {
    camera: playable(take.files.camera),
    screen: playable(take.files.screen),
    mic: playable(take.files.mic),
  };
  const expected = (killWin - take.t0Ms) / 1000;
  const lost =
    files.camera.durationSeconds === null
      ? expected
      : Math.max(0, expected - files.camera.durationSeconds);
  ctx.measured.crash_files_playable =
    Object.values(files).filter(isPlayable).length;
  ctx.measured.crash_take_recovered = recovered ? 1 : 0;
  ctx.measured.crash_seconds_lost = lost;
  ctx.measured.crash_recovery_ms = hello.at - restartAt;
  ctx.details.crash = {
    orphansStoppedByHarness: orphansStopped,
    recordingSessionId: take.id,
    secondsRecordedBeforeKill: expected,
    files,
    recovered: hello.message.type === "hello" ? hello.message.recovered : [],
  };
  // The restarted service opens again, as the editor would.
  await openRecorder(ctx);
};
