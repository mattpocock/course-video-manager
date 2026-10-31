import type {
  Launch,
  LaunchedProcess,
  Launcher,
} from "../../recorder-service/launcher";
import { spawn, type ChildProcess } from "node:child_process";
import {
  findFfmpegExe,
  launchCommand,
} from "../../recorder-service/windows-launcher";
import {
  CAMERA_SOURCE,
  CAMERA_TO_4K_ON_GPU,
  MIC_SOURCE,
  SCREEN_SOURCE,
  SCREEN_SOURCE_CPU,
  SCREEN_TO_D3D11,
  SYNTHETIC_DEVICE_LISTING,
  SYNTHETIC_SCREENS,
} from "./synthetic-sources";
import { killMarked, windowsGuard } from "./windows";

/**
 * THE SCORECARD'S LAUNCHER: the real recorder service's one seam
 * (`launcher.ts`), wrapped so the service runs exactly as in production —
 * the real ffmpeg.exe, the real arguments, NVENC — except that:
 *
 * - every DirectShow input (the Cam Link, the mic) and every ddagrab input
 *   (the DELL) becomes a synthetic lavfi source (`synthetic-sources.ts`);
 * - the device and screen listings are answered with the synthetic devices,
 *   so nothing real is ever listed, let alone opened;
 * - every ffmpeg.exe carries the run's marker in its `comment=` tag, and
 *   `stop-recorders.ps1` is replaced by `killMarked`, which only stops
 *   processes with that marker. The real script matches by tag alone, and
 *   the tags are the same in Matt's own recorder.
 *
 * - every process starts through the Windows guard
 *   (`scripts/windows-guard.ts`): Idle priority on cores 6-9;
 * - `timer-resolution.ps1` is not run: it raises the screen recorder, the
 *   capture and the writer to High priority, which the guard's job object
 *   forbids anyway. Each run reports a failure, which the service only logs.
 *
 * nvidia-smi runs for real.
 */

const fakeProcess = (stdout: string, stderr: string, code = 0) => {
  const out: ((chunk: string) => void)[] = [];
  const err: ((chunk: string) => void)[] = [];
  const exited = new Promise<number | null>((resolve) =>
    setImmediate(() => {
      for (const l of out) l(stdout);
      for (const l of err) l(stderr);
      resolve(code);
    })
  );
  return {
    onStdout: (l) => void out.push(l),
    onStderr: (l) => void err.push(l),
    writeStdin: () => {},
    exited,
    kill: () => {},
  } satisfies LaunchedProcess;
};

/** A process that runs `work` and exits 0 once it is done. */
const workProcess = (work: () => Promise<unknown>): LaunchedProcess => {
  const err: ((chunk: string) => void)[] = [];
  const exited = work().then(
    () => 0,
    (e: unknown) => {
      for (const l of err) l(`${String(e)}\n`);
      return 1;
    }
  );
  return {
    onStdout: () => {},
    onStderr: (l) => void err.push(l),
    writeStdin: () => {},
    exited,
    kill: () => {},
  };
};

/**
 * A synthetic picture input keeps its own stamps (Windows wall time, as
 * due: `clockPicture`) rather than the wall clock at read, which only adds
 * the source's own pacing jitter: the scorecard measures the recorder, not
 * lavfi. The mic keeps the wall clock: its anchoring (`micAnchor`) is made
 * for read-time stamps.
 */
const dropWallclock = (out: string[]) => {
  const at = out.lastIndexOf("-use_wallclock_as_timestamps");
  if (at !== -1 && at >= out.length - 4) out.splice(at, 2);
};

/**
 * The stand-in's D3D11 device, on the NVIDIA GPU (vendor 0x10de) as
 * ddagrab's own device is on the GPU driving the DELL. Never DXGI's default
 * adapter: that can be the Ryzen iGPU, where NVENC will not open, and every
 * take's screen recorder exits at Record (#2441).
 */
const D3D11 = [
  "-init_hw_device",
  "d3d11va=scd3d:,vendor_id=0x10de",
  "-filter_hw_device",
  "scd3d",
];

/** ffmpeg.exe's arguments with every device made synthetic and the marker added. */
export const syntheticFfmpegArgs = (
  args: readonly string[],
  marker: string
): string[] => {
  const out: string[] = [];
  /** A screen preview's synthetic frame goes through this graph; its `-map 0:v` is redirected. */
  let screenPreviewGraph: string | undefined;
  let screenRecorder = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-f" && args[i + 1] === "dshow") {
      let j = i;
      while (j < args.length && args[j] !== "-i") j++;
      const device = args[j + 1] ?? "";
      if (device.startsWith("video=")) dropWallclock(out);
      out.push(
        "-f",
        "lavfi",
        "-i",
        device.startsWith("video=") ? CAMERA_SOURCE : MIC_SOURCE
      );
      i = j + 1;
      continue;
    }
    if (
      a === "-f" &&
      args[i + 1] === "lavfi" &&
      args[i + 2] === "-i" &&
      args[i + 3]?.startsWith("ddagrab=")
    ) {
      const grab = args[i + 3]!;
      if (grab.includes("settb=AVTB")) {
        // The screen recorder: its graph uploads the frame where ddagrab's would be.
        screenRecorder = true;
        dropWallclock(out);
        out.push(...D3D11, "-f", "lavfi", "-i", `${SCREEN_SOURCE},settb=AVTB`);
      } else if (grab.includes("scale_d3d11")) {
        // The NVENC screen preview: up to D3D11 NV12, as its chain makes it.
        screenPreviewGraph = `[0:v]${SCREEN_TO_D3D11}[scsv]`;
        out.push(...D3D11, "-f", "lavfi", "-i", SCREEN_SOURCE);
      } else {
        // The libx264 screen preview takes BGRA in system memory: as made.
        out.push("-f", "lavfi", "-i", SCREEN_SOURCE_CPU);
      }
      i += 3;
      continue;
    }
    if (args[i - 1] === "-filter_complex") {
      if (a.startsWith("[0:v]hwupload_cuda,")) {
        out.push(
          a.replace("[0:v]hwupload_cuda,", `[0:v]${CAMERA_TO_4K_ON_GPU}`)
        );
        continue;
      }
      if (screenRecorder && a.startsWith("[0:v]")) {
        out.push(a.replace("[0:v]", `[0:v]${SCREEN_TO_D3D11},`));
        continue;
      }
    }
    if (screenPreviewGraph && a === "-map" && args[i + 1] === "0:v") {
      out.push("-filter_complex", screenPreviewGraph, "-map", "[scsv]");
      i += 1;
      continue;
    }
    if (args[i - 1] === "-metadata" && a.startsWith("comment=")) {
      out.push(`${a} ${marker}`);
      continue;
    }
    out.push(a);
  }
  return out;
};

/** The `-Tags a,b` a `stop-recorders.ps1` launch names. */
const tagsOf = (args: readonly string[]) =>
  (args[args.indexOf("-Tags") + 1] ?? "").split(",").filter(Boolean);

/**
 * `windows-launcher.ts`'s process, started at Idle on cores 6-9. Its kill
 * ends the launcher, and the launcher's job object ends the program.
 */
const idleProcess = (
  exe: string,
  args: readonly string[],
  cwd: string
): LaunchedProcess => {
  const child = windowsGuard().spawn(exe, args, { cwd });
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  child.stdin?.on("error", () => {});
  return {
    onStdout: (l) =>
      void child.stdout?.on("data", (d: Buffer) => l(d.toString())),
    onStderr: (l) =>
      void child.stderr?.on("data", (d: Buffer) => l(d.toString())),
    writeStdin: (text) => {
      if (child.exitCode === null) child.stdin?.write(text);
    },
    exited,
    kill: () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};

/** Each card server the scorecard's service started, newest last. */
const cardServers: ChildProcess[] = [];

/**
 * The real card server (a Node process in WSL, not a Windows exe), kept so
 * the scorecard can stall it mid-take (`stallCardServer`).
 */
const cardServerProcess = (launch: Launch): LaunchedProcess => {
  const cmd = launchCommand(launch);
  const child = spawn(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  cardServers.push(child);
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  child.stdin.on("error", () => {});
  const listen =
    (stream: NodeJS.ReadableStream) => (l: (chunk: string) => void) =>
      void stream.on("data", (d: Buffer) => l(d.toString()));
  return {
    onStdout: listen(child.stdout),
    onStderr: listen(child.stderr),
    writeStdin: (text) => {
      if (child.exitCode === null) child.stdin.write(text);
    },
    exited,
    kill: () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};

/**
 * Stops the running card server dead for `ms` (SIGSTOP, then SIGCONT), as
 * one hung mid-render would be. False if none is running.
 */
export const stallCardServer = (ms: number) => {
  const child = cardServers.findLast(
    (c) => c.exitCode === null && c.signalCode === null
  );
  if (!child?.kill("SIGSTOP")) return false;
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGCONT");
  }, ms);
  return true;
};

export const syntheticLauncher = (o: {
  marker: string;
  /** Each ffmpeg.exe started, with its (rewritten) arguments. */
  onLaunch?: (args: readonly string[]) => void;
}): Launcher => {
  return (launch: Launch) => {
    switch (launch.tool) {
      case "ffmpeg": {
        if (launch.args.includes("-list_devices"))
          return fakeProcess("", SYNTHETIC_DEVICE_LISTING);
        const exe = findFfmpegExe();
        if (!exe) return fakeProcess("", "ffmpeg.exe not found\n", 1);
        const args = syntheticFfmpegArgs(launch.args, o.marker);
        o.onLaunch?.(args);
        return idleProcess(exe, args, launch.cwd);
      }
      case "card-server":
        return cardServerProcess(launch);
      case "nvidia-smi":
        return idleProcess(
          "C:\\Windows\\System32\\nvidia-smi.exe",
          launch.args,
          "/mnt/c"
        );
      case "powershell":
        switch (launch.script) {
          case "screens.ps1":
            return fakeProcess(SYNTHETIC_SCREENS, "");
          case "stop-recorders.ps1":
            return workProcess(() => killMarked(o.marker, tagsOf(launch.args)));
          case "load-sampler.ps1":
            // The scorecard samples its own load (windows.ts).
            return fakeProcess(
              "",
              "skipped: the scorecard samples load itself\n",
              1
            );
          case "timer-resolution.ps1":
            return fakeProcess(
              "",
              "skipped: the scorecard keeps every process at Idle priority\n",
              1
            );
        }
    }
  };
};
