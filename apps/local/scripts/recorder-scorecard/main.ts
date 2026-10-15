/**
 * THE RECORDER SCORECARD: drives the real CVM recorder service end to end
 * on synthetic sources and scores it on speed and reliability against its
 * targets and OBS (docs/recorder-scorecard/README.md).
 *
 *   pnpm recorder:scorecard [--quick] [--out <dir>] [--long-take <s>]
 *     [--cycles <n>] [--fault-repeats <n>] [--keep-footage]
 *
 * Writes `scorecard.json` and `scorecard.md` to `--out` (default
 * `.data/recorder-scorecard/<run>/`). Opens no capture device and no real
 * screen. Starts no Windows process unless the Windows guard allows it
 * (exits 3 while Matt's recorder service runs, anything records, or OBS
 * runs), and stops everything at once if any of those starts mid-run.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIC_NAME } from "../../app/mic-device";
import { RECORDER_CAMERA_NAME } from "../../app/av-calibration-constants";
import { cycles, crash } from "./faults";
import type { Measured } from "./metrics";
import { openPreviewProbe } from "./preview-probe";
import { renderJson, renderMarkdown, type RunInfo } from "./report";
import { eventLogFailure, idle, longTake, previewKill } from "./scenarios";
import { connect, isState, startService } from "./service-control";
import { SYNTHETIC_THRESHOLD_DB } from "./synthetic-sources";
import { Aborted, openRecorder, sleep, watchFeeds, type Ctx } from "./takes";
import {
  killRun,
  liveRecorderState,
  logicalCpus,
  notIdle,
  foreignRecorderReasons,
  obsRunning,
  sampleGpu,
  sampleMarked,
  useGuard,
} from "./windows";
import {
  checkWindows,
  guardWindows,
  REFUSED_EXIT_CODE,
} from "../windows-guard";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const quick = args.includes("--quick");
const longTakeSeconds = Number(flag("--long-take") ?? (quick ? 60 : 600));
const cycleCount = Number(flag("--cycles") ?? (quick ? 10 : 50));
const faultRepeats = Number(flag("--fault-repeats") ?? (quick ? 3 : 5));
const keepFootage = args.includes("--keep-footage");

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const marker = `cvm-scorecard-${runId}`;
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const outDir = path.resolve(
  flag("--out") ?? path.join(repoRoot, ".data/recorder-scorecard", runId)
);
const workDir = path.join(os.tmpdir(), `cvm-recorder-scorecard-${runId}`);

const log = (line: string) =>
  console.log(`[scorecard ${new Date().toISOString().slice(11, 19)}] ${line}`);

/** Nothing the scorecard writes may land on a Windows drive. */
const refuseMnt = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  if (real.startsWith("/mnt/"))
    throw new Error(`Refusing to write under /mnt: ${dir} is ${real}`);
};
refuseMnt(outDir);
refuseMnt(workDir);
const stateDir = path.join(workDir, "state");
const footageDir = path.join(workDir, "footage");
fs.mkdirSync(footageDir, { recursive: true });

let aborted = false;

const main = async () => {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const measured: Measured = {};
  const details: Record<string, unknown> = {
    errors: {} as Record<string, string>,
  };
  const notes: string[] = [
    "Footage is written to WSL's own disk (ffmpeg.exe reaches it over \\\\wsl.localhost), never to a Windows drive; Matt's footage goes to a Windows drive, so finalisation times here include the WSL file share.",
    `A/V drift is measured over the long take (${longTakeSeconds} s, real time), first minute against last.`,
  ];

  // THE GATE (`scripts/windows-guard.ts`): nothing starts on Windows while
  // Matt's recorder service runs at all, while anything of his records, or
  // while OBS runs; everything that does start runs at Idle on cores 6-9.
  const reasons = checkWindows();
  if (reasons.length > 0) {
    log(`not run, the Windows guard refuses:\n  - ${reasons.join("\n  - ")}`);
    process.exitCode = REFUSED_EXIT_CODE;
    return;
  }
  useGuard(guardWindows());
  notes.push(
    "Every Windows process ran through the Windows guard (Idle priority, cores 6-9), checked every 5 s; timer-resolution.ps1 and raise-priority.ps1 were not run (they raise the capture, writer and screen recorder to High)."
  );
  let ctxRef: Ctx | undefined;
  let stopEverything: () => Promise<void> = async () => {
    await killRun(marker);
  };
  /**
   * THE GUARD, every 5 s: Matt starts a take, OBS starts, or a process of
   * the run is found off Idle or off cores 6-9, and everything of the run on
   * Windows is killed at once, by its marker, before anything else.
   */
  const emergency = (why: string) => {
    if (aborted) return;
    aborted = true;
    log(`STOPPING NOW: ${why}`);
    notes.push(`ABORTED at ${new Date().toISOString()}: ${why}.`);
    void stopEverything().then(() =>
      log("every Windows process of the run is stopped")
    );
  };
  let checking = false;
  const guard = setInterval(() => {
    if (checking || aborted) return;
    checking = true;
    void Promise.all([liveRecorderState(), obsRunning(), sampleMarked(marker)])
      .then(async ([state, obs, sample]) => {
        const foreign = foreignRecorderReasons(marker);
        if (state === "recording") emergency("Matt's recorder started a take");
        else if (foreign.length) emergency(foreign.join(" "));
        else if (obs) emergency("OBS is running");
        else {
          const off = await notIdle(sample, () => sampleMarked(marker));
          if (off.length)
            emergency(`ffmpeg.exe off Idle/cores 6-9: ${JSON.stringify(off)}`);
        }
      })
      .finally(() => (checking = false));
  }, 5000);

  const gpuBefore = await sampleGpu(3000);
  if (gpuBefore)
    notes.push(
      `GPU before the service started: ${Math.round(gpuBefore.gpuPct)}% busy, NVENC ${Math.round(gpuBefore.encoderPct)}%, ${Math.round(gpuBefore.memoryMb)} MiB.`
    );
  const cpus = await logicalCpus();
  log(`run ${runId}: service starting (marker ${marker})`);
  const service = await startService({
    marker,
    stateDir,
    logFile: path.join(workDir, "service.log"),
  });
  stopEverything = async () => {
    await (ctxRef?.service ?? service).kill().catch(() => {});
    await killRun(marker);
  };
  const client = await connect(service.port);
  const hello = await client.waitFor((m) => m.type === "hello", {
    what: "hello",
  });
  if (hello.message.type === "hello" && !hello.message.ffmpeg.ok)
    throw new Error(`ffmpeg.exe refused: ${hello.message.ffmpeg.message}`);

  const ctx: Ctx = {
    marker,
    stateDir,
    footageDir,
    videoId: `scorecard-${runId}`,
    calibration: {
      id: `scorecard-${runId}`,
      createdAtMs: Date.now(),
      thresholdDb: SYNTHETIC_THRESHOLD_DB,
      recorderMic: MIC_NAME,
      browserInputLabel: null,
      cameraDevice: RECORDER_CAMERA_NAME,
    },
    service,
    client,
    feeds: watchFeeds(service.port),
    probe: undefined,
    cpus,
    measured,
    details,
    log,
    checkAbort: () => {
      if (aborted) throw new Aborted("The guard stopped the run");
    },
  };
  ctxRef = ctx;

  details.openToLiveMs = await openRecorder(ctx);
  log(`camera live after ${Math.round(details.openToLiveMs as number)} ms`);
  try {
    ctx.probe = await openPreviewProbe(service.port);
  } catch (e) {
    notes.push(
      `Preview latency not measured: the browser did not start (${e instanceof Error ? e.message.split("\n")[0] : String(e)}).`
    );
  }
  await sleep(4000);

  const scenarios: [string, () => Promise<void>][] = [
    ["idle", () => idle(ctx, gpuBefore)],
    ["longTake", () => longTake(ctx, longTakeSeconds, gpuBefore)],
    ["previewKill", () => previewKill(ctx, 15, faultRepeats)],
    ["eventLogFailure", () => eventLogFailure(ctx)],
    ["cycles", () => cycles(ctx, cycleCount)],
    [
      "crash",
      async () => {
        await ctx.probe?.close();
        ctx.probe = undefined;
        await crash(ctx);
      },
    ],
  ];
  for (const [name, run] of scenarios) {
    if (aborted) break;
    try {
      await run();
    } catch (e) {
      if (e instanceof Aborted) break;
      log(`${name} failed: ${e instanceof Error ? e.stack : String(e)}`);
      (details.errors as Record<string, string>)[name] =
        e instanceof Error ? e.message.slice(0, 2000) : String(e);
      // A take left recording is stopped before the next scenario.
      ctx.client.send({ type: "stop" });
      await sleep(3000);
    }
  }

  clearInterval(guard);
  await ctx.probe?.close();
  if (!aborted) {
    log("closing");
    try {
      const from = ctx.client.send({ type: "stop" });
      await sleep(1000);
      ctx.client.send({ type: "close" });
      await ctx.client.waitFor(isState("closed"), {
        from: from.from,
        timeoutMs: 30_000,
      });
    } catch (e) {
      log(`close: ${e instanceof Error ? e.message : String(e)}`);
    }
    await ctx.service.stop();
  }
  ctx.client.close();
  ctx.feeds.camera.close();
  ctx.feeds.screen.close();
  details.leftoverProcesses = await killRun(marker);

  const run: RunInfo = {
    startedAt,
    mode: quick ? "quick" : "full",
    commit,
    longTakeSeconds,
    cycles: cycleCount,
    wallSeconds: (performance.now() - started) / 1000,
    notes,
  };
  fs.writeFileSync(
    path.join(outDir, "scorecard.json"),
    renderJson(run, measured, details)
  );
  fs.writeFileSync(
    path.join(outDir, "scorecard.md"),
    renderMarkdown(run, measured)
  );
  log(`report: ${path.join(outDir, "scorecard.md")}`);
};

try {
  await main();
} finally {
  // Whatever happened, nothing of this run is left running on Windows.
  await killRun(marker).catch(() => 0);
  if (!keepFootage) fs.rmSync(workDir, { recursive: true, force: true });
  else log(`footage kept in ${workDir}`);
}
process.exit(0);
