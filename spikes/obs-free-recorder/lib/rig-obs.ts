// The OBS side of the rig: ./rig baseline (today's OBS, recorded through
// obs-websocket with nobody at the desk) and ./rig obs <verb>.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Meta } from "./analyze.ts";
import { startCollector } from "./collector.ts";
import {
  closeObs,
  launchObs,
  obsCall,
  obsReachable,
  obsRequest,
  obsRunning,
  obsUrl,
} from "./obs.ts";
import { startServer } from "./server.ts";
import { windowsFileCreatedMs, windowsNowMs } from "./win.ts";

/** What baseline() needs from rig.ts: its flags and the helpers every mode shares. */
export type BaselineContext = {
  flags: {
    minutes?: string;
    out?: string;
    "flash-every"?: string;
    "obs-dir"?: string;
  };
  ports: { http: number; screen: number; camera: number };
  log: (...a: unknown[]) => void;
  sleep: (ms: number) => Promise<unknown>;
  newRunDir: (kind: string) => string;
  logicalCpus: () => number;
  openPage: (query: string) => void;
  closePage: () => void;
  printReport: (runDir: string, baselineDir?: string) => unknown;
};

/** A Windows path OBS reports (D:\\raw-footage\\x.mkv) as a WSL path. */
const fromWindowsPath = (p: string) =>
  execFileSync("wslpath", ["-u", p], { encoding: "utf8" }).trim();

/** The newest .mkv/.mp4 in --obs-dir: only if OBS's StopRecord gave no path. */
function newestObsFile(obsDir: string, minutes: number): string | undefined {
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
export async function baseline(c: BaselineContext) {
  const { flags, log, sleep } = c;
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

  const runDir = c.newRunDir("baseline");
  const t0Ms = windowsNowMs();
  const meta: Meta = {
    mode: "baseline",
    t0Ms,
    startedWallMs: t0Ms,
    // OBS's camera watches the phone too: lip sync vs OBS compares like with like.
    cameraMarker: "phone",
    logicalCpus: c.logicalCpus(),
  };
  let stop = false;
  const server = startServer({
    port: c.ports.http,
    previewPorts: { screen: c.ports.screen, camera: c.ports.camera },
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
  c.openPage("?baseline=1&auto=1");
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
  c.closePage();
  // Wait for the file to exist and stop growing (OBS finishes writing after StopRecord).
  let lastSize = -1;
  let stableSince = Date.now();
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    file ??= newestObsFile(flags["obs-dir"]!, minutes);
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
  c.printReport(runDir);
}

/** ./rig obs url | status | launch | close */
export async function obs(
  verb: string | undefined,
  log: (...a: unknown[]) => void
) {
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
