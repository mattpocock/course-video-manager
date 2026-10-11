// OBS-free recorder test rig. See RUN.md. Entry point: ./rig <mode>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyze, type Meta } from "./lib/analyze.ts";
import { checkRecovery } from "./lib/recovery.ts";
import { startCollector } from "./lib/collector.ts";
import type { ChildProcess } from "node:child_process";
import { passed } from "./lib/judge.ts";
import { runChecks } from "./lib/checks.ts";
import {
  buildArgs,
  FILES,
  SCREEN_MARKER_CROP,
  startRecorder,
  startScreenPreview,
  startSyntheticSources,
  stopRecorder,
  type Synthetic,
} from "./lib/recorder.ts";
import { startServer } from "./lib/server.ts";
import {
  closeObs,
  launchObs,
  obsCall,
  obsReachable,
  obsRequest,
  obsRunning,
  obsUrl,
} from "./lib/obs.ts";
import { runLipSyncProof } from "./lib/lipsync-proof.ts";
import {
  SYSTEM32,
  closeKioskPage,
  listScreens,
  openKioskPage,
  screenByName,
  type Screen,
  allowAnyFfmpeg,
  killWindowsFfmpeg,
  raiseFfmpegTimerResolution,
  listDshowDevices,
  startWindowsClock,
  windowsFileCreatedMs,
  windowsNowMs,
  windowsTool,
} from "./lib/win.ts";

const PORTS = { http: 4790, screen: 4791, camera: 4792 };
const URL_BASE = `http://localhost:${PORTS.http}/`;

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "/mnt/d/obs-rig" },
    minutes: { type: "string" },
    seconds: { type: "string" },
    "kill-at": { type: "string" },
    period: { type: "string" },
    "flash-every": { type: "string", default: "2" },
    // The DELL is found by its monitor name; --screen N forces an output index.
    screen: { type: "string" },
    "screen-name": { type: "string", default: "DELL U2424H" },
    // Tests only: never open the Chrome page (the baseline page opens a camera).
    "no-page": { type: "boolean", default: false },
    camera: { type: "string", default: "Cam Link 4K" },
    mic: { type: "string", default: "Voicemeeter Out B1" },
    baseline: { type: "string" },
    "obs-dir": { type: "string", default: "/mnt/d/raw-footage" },
    "real-screen": { type: "boolean", default: false },
    "real-screen-minutes": { type: "string", default: "3" },
    "skip-real-screen": { type: "boolean", default: false },
    "no-audio-correction": { type: "boolean", default: false },
    "skip-crash": { type: "boolean", default: false },
    synthetic: { type: "boolean", default: false },
    open: { type: "boolean", default: false },
    "any-ffmpeg": { type: "boolean", default: false },
  },
});
const mode = positionals[0];
if (flags["any-ffmpeg"]) allowAnyFfmpeg();

// Every child process, so a crash or Ctrl+C never leaves an ffmpeg.exe or a
// synthetic source running on Windows.
const children = new Set<ChildProcess>();
// Each Windows-side helper adds its own exit hook; a selftest starts ~20.
process.setMaxListeners(64);
const track = <T extends ChildProcess | undefined>(c: T): T => {
  if (c) children.add(c);
  return c;
};
let kioskOpen = false;
process.on("exit", () => {
  for (const c of children) if (c.exitCode === null) c.kill();
  if (kioskOpen) closeKioskPage();
});

const log = (...a: unknown[]) =>
  console.log(`[rig ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let resolvedScreen: Screen | undefined;
/** The captured monitor: --screen N, else the one named --screen-name (the DELL). */
function theScreen(): Screen {
  if (resolvedScreen) return resolvedScreen;
  if (flags.screen !== undefined) {
    const s = listScreens().find((x) => x.idx === Number(flags.screen));
    if (!s) throw new Error(`No screen with index ${flags.screen}`);
    resolvedScreen = s;
  } else {
    resolvedScreen = screenByName(flags["screen-name"]!);
  }
  log(
    `screen ${resolvedScreen.idx}: ${resolvedScreen.name} (${resolvedScreen.w}x${resolvedScreen.h} at ${resolvedScreen.x},${resolvedScreen.y})`
  );
  return resolvedScreen;
}

/** Opens the preview page fullscreen on the DELL, no click needed (lib/win.ts). */
function openPage(query: string) {
  if (flags["no-page"]) {
    log(`--no-page: not opening ${URL_BASE}${query}`);
    return;
  }
  openKioskPage(`${URL_BASE}${query}`, theScreen(), flags.out!);
  kioskOpen = true;
}
function closePage() {
  if (!kioskOpen) return;
  closeKioskPage();
  kioskOpen = false;
}

function newRunDir(kind: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(flags.out!, "runs", `${stamp}-${kind}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logicalCpus() {
  return Number(
    execFileSync(`${SYSTEM32}/cmd.exe`, ["/c", "echo %NUMBER_OF_PROCESSORS%"], {
      cwd: "/mnt/c",
      encoding: "utf8",
    }).trim()
  );
}

function latestRun(kind: string): string | undefined {
  const runs = path.join(flags.out!, "runs");
  if (!fs.existsSync(runs)) return undefined;
  const dirs = fs
    .readdirSync(runs)
    .filter(
      (d) =>
        d.endsWith(`-${kind}`) &&
        fs.existsSync(path.join(runs, d, "report.json"))
    );
  return dirs.length ? path.join(runs, dirs.sort().at(-1)!) : undefined;
}

function resolveDevice(kind: "video" | "audio", wanted: string): string {
  const devices = listDshowDevices().filter((d) => d.kind === kind);
  const hit = devices.find((d) =>
    d.name.toLowerCase().includes(wanted.toLowerCase())
  );
  if (!hit) {
    throw new Error(
      `No DirectShow ${kind} device matching "${wanted}". Found: ${devices.map((d) => d.name).join(", ") || "none"}. Is OBS still open?`
    );
  }
  return hit.name;
}

type RecordPlan = {
  kind: Meta["mode"];
  seconds: number;
  synthetic?: Synthetic;
  killAt?: number;
  openPage: boolean;
};

async function record(plan: RecordPlan): Promise<string> {
  const runDir = newRunDir(plan.kind);
  const tag = `obs-rig-${path.basename(runDir)}`;
  let camera: string | undefined;
  let mic: string | undefined;
  if (!plan.synthetic) {
    camera = resolveDevice("video", flags.camera!);
    mic = resolveDevice("audio", flags.mic!);
    log(`devices: camera "${camera}", mic "${mic}"`);
  }
  let generators: ChildProcess[] = [];
  if (plan.synthetic) {
    generators = (
      await startSyntheticSources(
        plan.synthetic,
        plan.synthetic.realScreen ? theScreen().idx : 0,
        (name, line) =>
          fs.appendFileSync(path.join(runDir, `synthetic-${name}.log`), line)
      )
    ).map(track);
  }
  // Every progress block is stamped with Windows time, for pipeline lag.
  const winClock = startWindowsClock();
  await winClock.ready;
  const t0Ms = windowsNowMs();
  const meta: Meta = {
    mode: plan.kind,
    t0Ms,
    startedWallMs: t0Ms,
    synthetic: plan.synthetic && {
      period: plan.synthetic.period,
      camSpeed: plan.synthetic.camSpeed,
      micSpeed: plan.synthetic.micSpeed,
      noAudioCorrection: plan.synthetic.noAudioCorrection,
      realScreen: plan.synthetic.realScreen,
      screenCrop: plan.synthetic.realScreen ? SCREEN_MARKER_CROP : undefined,
    },
    logicalCpus: logicalCpus(),
  };
  const writeMeta = () =>
    fs.writeFileSync(
      path.join(runDir, "meta.json"),
      JSON.stringify(meta, null, 2)
    );
  writeMeta();

  let stopRequested = false;
  const server = startServer({
    port: PORTS.http,
    previewPorts: { screen: PORTS.screen, camera: PORTS.camera },
    runDir,
    ghostDir: flags.out!,
    config: {
      mode: plan.kind,
      t0Ms,
      flashEveryMs: plan.synthetic ? 0 : Number(flags["flash-every"]) * 60_000,
      synthetic: !!plan.synthetic,
      // Synthetic flashes fall on wall-clock multiples of the period.
      syntheticPeriodMs: plan.synthetic ? plan.synthetic.period * 1000 : 0,
    },
    onStopRequest: () => (stopRequested = true),
  });

  const args = buildArgs({
    t0Ms,
    tag,
    screenIdx:
      plan.synthetic && !plan.synthetic.realScreen ? 0 : theScreen().idx,
    camera,
    mic,
    synthetic: plan.synthetic,
    previewPorts: { screen: PORTS.screen, camera: PORTS.camera },
  });
  fs.writeFileSync(
    path.join(runDir, "ffmpeg-args.json"),
    JSON.stringify(args, null, 1)
  );
  // Two recorder processes (see lib/recorder.ts for why), each with its own log and progress.
  const procs = (["screen", "camera"] as const).map((name) => {
    const logStream = fs.createWriteStream(
      path.join(runDir, `ffmpeg-${name}.log`)
    );
    const state = {
      name,
      last: {} as Record<string, string>,
      logStream,
      child: undefined as unknown as ChildProcess,
    };
    state.child = track(
      startRecorder(
        runDir,
        args[name],
        (p) => {
          state.last = p;
          fs.appendFileSync(
            path.join(runDir, `progress-${name}.jsonl`),
            JSON.stringify({ ...p, winMs: winClock.now() }) + "\n"
          );
        },
        (chunk) => logStream.write(chunk)
      )
    );
    return state;
  });
  // ddagrab loses frames at Windows' default 15.6 ms timer tick, and ffmpeg
  // never raises it (see lib/timer-resolution.ps1). Raise it inside the screen
  // recorder, as OBS does for itself. Only when ddagrab is capturing: the
  // synthetic screen is paced by its source, and a High-priority screen
  // process there only competes with the synthetic camera.
  if (!plan.synthetic || plan.synthetic.realScreen) {
    const timer = await raiseFfmpegTimerResolution(tag, FILES.screen);
    meta.screenTimerResolution = timer;
    writeMeta();
    log(
      timer.ok
        ? `screen recorder: ${timer.detail}`
        : `WARNING: could not raise the screen recorder's timer resolution, expect dropped screen frames: ${timer.detail}`
    );
  }
  const recordStartedAt = performance.now();
  const screenPreviewLog = fs.createWriteStream(
    path.join(runDir, "ffmpeg-screen-preview.log")
  );
  const screenPreview = track(
    !plan.synthetic || plan.synthetic.realScreen
      ? startScreenPreview(theScreen().idx, PORTS.screen, (c) =>
          screenPreviewLog.write(c)
        )
      : undefined
  );
  log(`recording to ${runDir}`);
  if (plan.openPage) openPage("?auto=1");
  else log(`preview: ${URL_BASE}`);

  await sleep(3000);
  const collector = startCollector(runDir, () =>
    [FILES.screen, FILES.camera, FILES.mic].map((f) => path.join(runDir, f))
  );
  const onSigint = () => (stopRequested = true);
  process.on("SIGINT", onSigint);

  // Time is ffmpeg's file time (Windows clock); WSL's own clock ran ~4% slow on
  // this machine. The slower of the two processes decides.
  const fileTime = () =>
    Math.min(...procs.map((p) => Number(p.last.out_time_us ?? 0) / 1e6 || 0));
  const anyExited = () => procs.some((p) => p.child.exitCode !== null);
  const wslStart = Date.now();
  let lastPrint = 0;
  let lastOut = -1;
  let lastOutChange = Date.now();
  while (!anyExited() && !stopRequested) {
    const t = fileTime();
    if (t !== lastOut) {
      lastOut = t;
      lastOutChange = Date.now();
    } else if (Date.now() - lastOutChange > 20_000) {
      log(
        "no output for 20 s: an input is delivering nothing (see ffmpeg-*.log). Stopping."
      );
      break;
    }
    if (plan.killAt !== undefined && t >= plan.killAt) break;
    if (
      t >= plan.seconds ||
      Date.now() - wslStart > plan.seconds * 1500 + 60_000
    )
      break;
    if (Date.now() - lastPrint > 15_000) {
      lastPrint = Date.now();
      const p = Object.fromEntries(procs.map((x) => [x.name, x.last]));
      log(
        `${Math.round(t)}s / ${plan.seconds}s  screen ${p.screen?.fps ?? "?"} fps, camera ${p.camera?.fps ?? "?"} fps, speed ${p.camera?.speed ?? "?"}  preview frames ${server.frames.screen}/${server.frames.camera}`
      );
    }
    await sleep(100);
  }
  process.off("SIGINT", onSigint);
  meta.preview = server.previewStats(recordStartedAt, ["screen", "camera"]);

  const exited = procs.filter((p) => p.child.exitCode !== null);
  if (exited.length) {
    log(
      `ffmpeg (${exited.map((p) => p.name).join(", ")}) exited early; see ffmpeg-*.log in ${runDir}`
    );
  }
  if (plan.killAt !== undefined && !exited.length) {
    const killed = killWindowsFfmpeg(tag);
    // Each process's own kill moment, read on Windows inside the kill call.
    const killedAtFileTime = Object.fromEntries(
      killed.map((k) => [k.role, (k.killedAtMs - t0Ms) / 1000])
    );
    killedAtFileTime.mic = killedAtFileTime.camera!;
    log(
      `kill -9 (TerminateProcess) ffmpeg.exe ${killed.map((k) => `${k.role} pid ${k.pid} at file time ${((k.killedAtMs - t0Ms) / 1000).toFixed(3)} s`).join(", ")}`
    );
    await Promise.all(
      procs.map(
        (p) =>
          new Promise((r) =>
            p.child.exitCode !== null ? r(null) : p.child.once("exit", r)
          )
      )
    );
    meta.crash = checkRecovery(runDir, killedAtFileTime);
    log(
      `recovery: ${meta.crash.pass ? "PASS" : "FAIL"}`,
      JSON.stringify(meta.crash.files)
    );
  } else {
    log("stopping ffmpeg (q)…");
    await Promise.all(
      procs.map((p) =>
        stopRecorder(p.child, () => {
          log(`ffmpeg (${p.name}) did not stop on q; force-killing it`);
          killWindowsFfmpeg(tag);
        })
      )
    );
  }
  closePage();
  collector.stop();
  server.close();
  for (const p of procs) p.logStream.end();
  for (const g of generators) g.kill();
  screenPreview?.stdin?.write("q");
  screenPreviewLog.end();
  winClock.stop();
  meta.endedWallMs = windowsNowMs();
  writeMeta();
  return runDir;
}

function printReport(runDir: string, baselineDir?: string) {
  log("analysing…");
  const r = analyze(runDir, baselineDir);
  console.log(
    fs
      .readFileSync(path.join(runDir, "report.md"), "utf8")
      .split("## Frames")[0]
  );
  log(`full report: ${path.join(runDir, "report.md")}`);
  return r;
}

/** A Windows path OBS reports (D:\\raw-footage\\x.mkv) as a WSL path. */
const fromWindowsPath = (p: string) =>
  execFileSync("wslpath", ["-u", p], { encoding: "utf8" }).trim();

/** The newest .mkv/.mp4 in --obs-dir: only if OBS's StopRecord gave no path. */
function newestObsFile(minutes: number): string | undefined {
  const obsDir = flags["obs-dir"]!;
  if (!fs.existsSync(obsDir)) return undefined;
  return fs
    .readdirSync(obsDir)
    .filter((f) => /\.(mkv|mp4)$/i.test(f))
    .map((f) => path.join(obsDir, f))
    .filter(
      (f) => fs.statSync(f).mtimeMs > Date.now() - (minutes + 10) * 60_000
    )
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/**
 * Today's OBS, measured with nobody at the desk: launch OBS if needed, set
 * Matt's landscape profile, the Code scene and the Virtual Camera (the page's
 * preview), record through obs-websocket for --minutes, stop, and wait for the
 * file. OBS is left running; ./rig obs close closes it.
 */
async function baseline() {
  const minutes = Number(flags.minutes ?? 30);
  const { url, from } = obsUrl();
  log(`OBS websocket ${url} (${from})`);
  log(`OBS: ${await launchObs(log)}`);
  const [profiles, rec, vcam] = obsCall(
    { requestType: "GetProfileList" },
    { requestType: "GetRecordStatus" },
    { requestType: "GetVirtualCamStatus" }
  );
  if (rec?.data?.outputActive) {
    log("OBS was already recording: stopping that recording first");
    obsRequest("StopRecord");
    await sleep(2000);
  }
  const LANDSCAPE = "Landscape Recording"; // CVM's profile for landscape videos (ensure-obs-profile.ts)
  const profileList = (profiles?.data?.profiles ?? []) as string[];
  if (
    profileList.includes(LANDSCAPE) &&
    profiles?.data?.currentProfileName !== LANDSCAPE
  ) {
    obsRequest("SetCurrentProfile", { profileName: LANDSCAPE });
    await sleep(3000);
  }
  obsRequest("SetCurrentProgramScene", { sceneName: "Code" });
  if (!vcam?.data?.outputActive) obsRequest("StartVirtualCam");
  await sleep(2000);

  const runDir = newRunDir("baseline");
  const t0Ms = windowsNowMs();
  const meta: Meta = {
    mode: "baseline",
    t0Ms,
    startedWallMs: t0Ms,
    logicalCpus: logicalCpus(),
  };
  let stop = false;
  const server = startServer({
    port: PORTS.http,
    previewPorts: { screen: PORTS.screen, camera: PORTS.camera },
    runDir,
    ghostDir: flags.out!,
    config: {
      mode: "baseline",
      t0Ms,
      flashEveryMs: Number(flags["flash-every"]) * 60_000,
      synthetic: false,
    },
    onStopRequest: () => (stop = true),
  });
  process.on("SIGINT", () => (stop = true));
  const collector = startCollector(runDir, () => []);
  obsRequest("StartRecord");
  log(`OBS recording (scene Code) for ${minutes} min`);
  openPage("?baseline=1&auto=1");
  const until = Date.now() + minutes * 60_000;
  let lastPrint = Date.now();
  while (!stop && Date.now() < until) {
    await sleep(1000);
    if (Date.now() - lastPrint > 60_000) {
      lastPrint = Date.now();
      log(`baseline ${Math.round((until - Date.now()) / 60_000)} min to go`);
    }
  }
  collector.stop();
  server.close();
  meta.endedWallMs = windowsNowMs();
  let file: string | undefined;
  try {
    const out = obsRequest("StopRecord");
    if (typeof out.outputPath === "string" && out.outputPath)
      file = fromWindowsPath(out.outputPath);
    log(`OBS stopped recording: ${out.outputPath ?? "(no path given)"}`);
  } catch (e) {
    log(`StopRecord failed: ${(e as Error).message}`);
  }
  closePage();
  // Wait for the file to exist and stop growing (OBS finishes writing after StopRecord).
  let lastSize = -1;
  let stableSince = Date.now();
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    file ??= newestObsFile(minutes);
    const size = file && fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size !== lastSize) {
      lastSize = size;
      stableSince = Date.now();
    } else if (size >= 0 && Date.now() - stableSince > 5000) break;
    await sleep(1000);
  }
  if (!file || !fs.existsSync(file))
    throw new Error("OBS's recording never appeared (StopRecord gave no file)");
  meta.obsFile = file;
  meta.obsFileStartWallMs = windowsFileCreatedMs(file);
  fs.writeFileSync(
    path.join(runDir, "meta.json"),
    JSON.stringify(meta, null, 2)
  );
  log(`OBS file: ${file}`);
  printReport(runDir);
}

/** ./rig obs url | status | launch | close */
async function obs(verb: string | undefined) {
  const say = (s: string) => log(`OBS: ${s}`);
  switch (verb) {
    case "url": {
      const { url, from } = obsUrl();
      console.log(`${url}\t${from}`);
      return;
    }
    case "status": {
      const running = obsRunning();
      say(
        `${running ? "running" : "not running"}${running ? (obsReachable() ? ", websocket answers" : ", websocket NOT answering") : ""}`
      );
      process.exit(running ? 0 : 3);
    }
    case "launch":
      say(await launchObs(say));
      return;
    case "close": {
      say(`closed: ${await closeObs(say)}`);
      if (obsRunning()) {
        say("still running");
        process.exit(1);
      }
      return;
    }
    default:
      console.log("usage: ./rig obs url | status | launch | close");
      process.exit(1);
  }
}

function screens() {
  const wanted = flags["screen-name"]!.toLowerCase();
  for (const sc of listScreens())
    log(
      `output ${sc.idx}: ${sc.name}  ${sc.w}x${sc.h} at ${sc.x},${sc.y}  ${sc.device}${sc.name.toLowerCase().includes(wanted) ? "  <- the rig records this one" : ""}`
    );
}

async function main() {
  switch (mode) {
    case "check": {
      process.exit(runChecks(log) ? 0 : 1);
    }
    case "selftest": {
      // 0. The review's repro cases against the verdict rules (no devices, no ffmpeg).
      if (!runChecks(log)) {
        log("SELFTEST FAIL (verdict rules)");
        process.exit(1);
      }
      windowsTool("ffmpeg"); // fails fast if the build isn't 8.0.1
      const base = {
        camSpeed: 1.0003, // camera crystal 300 ppm fast
        micSpeed: 0.9997, // mic clock 300 ppm slow
        period: Number(flags.period ?? 20),
        noAudioCorrection: flags["no-audio-correction"]!,
      };
      // Every verdict about the recorder itself must PASS; only the ones that
      // need a baseline (CPU/GPU) may be n/a.
      const gate = (r: { verdicts: Record<string, string> }) =>
        Object.entries(r.verdicts)
          .filter(([k]) => !k.startsWith("CPU/GPU"))
          .filter(([, v]) => !passed(v))
          .map(([k, v]) => `${k}: ${v}`);
      const failures: string[] = [];
      const phases: [string, boolean, number][] = [
        ["synthetic screen", false, Number(flags.minutes ?? 5)],
        ...(flags["skip-real-screen"]
          ? []
          : ([
              [
                "real screen (ddagrab + on-screen marker)",
                true,
                Number(flags["real-screen-minutes"]),
              ],
            ] as [string, boolean, number][])),
      ];
      for (const [label, realScreen, minutes] of phases) {
        log(`selftest phase: ${label}, ${minutes} min`);
        const runDir = await record({
          kind: "selftest",
          seconds: minutes * 60,
          synthetic: { ...base, realScreen },
          openPage: flags.open!,
        });
        failures.push(
          ...gate(printReport(runDir)).map((f) => `[${label}] ${f}`)
        );
      }
      if (!flags["skip-crash"]) {
        log("kill -9 recovery check (synthetic, 60 s, killed at 40 s)…");
        const crashDir = await record({
          kind: "crash",
          seconds: 60,
          killAt: 40,
          synthetic: { ...base, realScreen: false },
          openPage: false,
        });
        const meta = JSON.parse(
          fs.readFileSync(path.join(crashDir, "meta.json"), "utf8")
        ) as Meta;
        const crashPass = !!meta.crash?.pass;
        log(`kill -9 recovery: ${crashPass ? "PASS" : "FAIL"}  (${crashDir})`);
        if (!crashPass) failures.push("[crash] kill -9 recovery: FAIL");
      }
      for (const f of failures) log(`  ✗ ${f}`);
      log(failures.length ? "SELFTEST FAIL" : "SELFTEST PASS");
      process.exit(failures.length ? 1 : 0);
    }
    case "record": {
      const runDir = await record({
        kind: "record",
        seconds: Number(flags.minutes ?? 30) * 60 + 30,
        openPage: true,
      });
      printReport(runDir, flags.baseline ?? latestRun("baseline"));
      return;
    }
    case "crash": {
      const synthetic = flags.synthetic
        ? {
            camSpeed: 1,
            micSpeed: 1,
            period: 20,
            realScreen: flags["real-screen"]!,
            noAudioCorrection: false,
          }
        : undefined;
      const runDir = await record({
        kind: "crash",
        seconds: Number(flags.seconds ?? 90),
        killAt: Number(flags["kill-at"] ?? 60),
        synthetic,
        openPage: !synthetic,
      });
      printReport(runDir);
      return;
    }
    case "baseline":
      return baseline();
    case "analyze": {
      const dir = positionals[1];
      if (!dir)
        throw new Error("usage: ./rig analyze <runDir> [--baseline <dir>]");
      printReport(path.resolve(dir), flags.baseline ?? latestRun("baseline"));
      return;
    }
    case "screens":
      return screens();
    case "obs":
      return obs(positionals[1]);
    case "lipsync-proof":
      process.exit((await runLipSyncProof(flags.out!, log)) ? 0 : 1);
    default:
      console.log(
        "usage: ./rig selftest | check | baseline | record | crash | analyze <runDir> | screens | obs <verb> | lipsync-proof   (see RUN.md)"
      );
      process.exit(mode ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
