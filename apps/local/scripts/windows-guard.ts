import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
  type StdioOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * THE WINDOWS GUARD (#2214). Every script, harness or test that starts a
 * Windows-side process (ffmpeg.exe, PowerShell, anything `.exe`) calls
 * `guardWindows()` first, and starts those processes only through what it
 * returns. Never `spawn` a `.exe` directly.
 *
 *   const windows = await guardWindows();
 *   const ff = windows.spawn(findFfmpegExe()!, args, { cwd: dir });
 *
 * From a shell: `pnpm --filter @cvm/local windows-guard -- <exe> [args…]`
 * runs one program through it; `windows-guard --check` only checks.
 *
 * Why: `nice` and `taskset` stop at WSL's edge. A harness running ffmpeg.exe
 * at Normal priority on every core starved the live Cam Link capture and
 * lost a take 212 frames. So the guard:
 *
 * 1. REFUSES (prints why and exits 3) while anything is recording: the
 *    recorder service (started by an open video editor, until it idles out), any
 *    ffmpeg.exe it started (tagged `cvm-recorder-`), or OBS. Only the Linux
 *    side is looked at first, so a running recorder is found without
 *    starting a single Windows process; OBS takes one `tasklist.exe`.
 * 2. Starts every Windows process at IDLE priority on cores 6-9 (affinity
 *    0x3C0), through `idle-launch.exe`: a tiny launcher, compiled once per
 *    machine into the OS temp folder, that puts itself in a Windows job
 *    object with those two limits and then starts the real program inside
 *    it. Windows applies both from the program's first instruction, to it
 *    and everything it starts, and kills them all if the launcher dies.
 *    stdin, stdout and stderr pass straight through.
 */

/** Cores 6-9: the same cores `taskset -c 6-9` gives Linux-side work. */
export const AFFINITY_MASK = 0x3c0;

/** What `guardWindows` exits with when it refuses. */
export const REFUSED_EXIT_CODE = 3;

const SYSTEM32 = "/mnt/c/Windows/System32";
const POWERSHELL = `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`;
const TASKLIST = `${SYSTEM32}/tasklist.exe`;

/** OBS's executables, as `tasklist` names them. */
const OBS_IMAGES = ["obs64.exe", "obs32.exe", "obs.exe"];

/** What is running, as the guard sees it. */
export type RunningProcesses = {
  /** Every Linux-side process's command line (WSL-started `.exe`s included). */
  linux: readonly string[];
  /** Every Windows process's image name. Undefined: not looked at. */
  windows?: readonly string[];
};

/**
 * Why Windows processes may not start now; empty when they may. Pure, so
 * the refuse/allow rule is tested without a recorder.
 */
export const reasonsToRefuse = (running: RunningProcesses): string[] => {
  const reasons: string[] = [];
  if (
    running.linux.some((c) =>
      /recorder-service\/(run-recorder-service|service-process)\.ts/.test(c)
    )
  )
    reasons.push(
      "The CVM recorder service is running: it holds the Cam Link, the mic and the screen. A video editor started it; it stops once none has been open for a while (ADR 0053)."
    );
  if (running.linux.some((c) => /\.exe\b.*\bcvm-recorder-/i.test(c)))
    reasons.push("A CVM recorder ffmpeg.exe is running.");
  const obs = (running.windows ?? []).find((image) =>
    OBS_IMAGES.includes(image.toLowerCase())
  );
  if (obs) reasons.push(`OBS is running (${obs}).`);
  return reasons;
};

/** Every Linux-side process's command line, from /proc. Starts nothing. */
const linuxCommandLines = (): string[] => {
  const lines: string[] = [];
  for (const pid of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (raw) lines.push(raw.split("\0").join(" ").trim());
    } catch {
      // Gone since the listing.
    }
  }
  return lines;
};

/** Every Windows process's image name: one `tasklist.exe`. */
const windowsImageNames = (): string[] => {
  const run = spawnSync(TASKLIST, ["/FO", "CSV", "/NH"], {
    cwd: "/mnt/c",
    encoding: "utf8",
    timeout: 30_000,
  });
  if (run.status !== 0)
    throw new Error(
      `tasklist.exe failed, so OBS could not be ruled out: ${run.stderr || run.error?.message || run.status}`
    );
  return run.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]+)"/)?.[1])
    .filter((name): name is string => name !== undefined);
};

/**
 * Why Windows processes may not start now; empty when they may. Looks at
 * the Linux side first and stops there if that already refuses.
 */
export const checkWindows = (): string[] => {
  const linux = reasonsToRefuse({ linux: linuxCommandLines() });
  if (linux.length > 0) return linux;
  return reasonsToRefuse({
    linux: [],
    windows: windowsImageNames(),
  });
};

// ---------------------------------------------------------------------------
// idle-launch.exe

const LAUNCHER_SOURCE = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class IdleLaunch {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit;
    public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimits info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  const uint LIMIT_AFFINITY = 0x10, LIMIT_PRIORITY_CLASS = 0x20, LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const uint IDLE_PRIORITY_CLASS = 0x40;

  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\"");
    int slashes = 0;
    foreach (char c in a) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') sb.Append('\\\\', slashes * 2 + 1);
      else sb.Append('\\\\', slashes);
      slashes = 0;
      sb.Append(c);
    }
    sb.Append('\\\\', slashes * 2);
    return sb.Append('"').ToString();
  }

  public static int Main(string[] args) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var info = new ExtendedLimits();
    info.Basic.LimitFlags = LIMIT_AFFINITY | LIMIT_PRIORITY_CLASS | LIMIT_KILL_ON_JOB_CLOSE;
    info.Basic.Affinity = (UIntPtr)${AFFINITY_MASK};
    info.Basic.PriorityClass = IDLE_PRIORITY_CLASS;
    if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(ExtendedLimits))))
      { Console.Error.WriteLine("idle-launch: SetInformationJobObject failed " + Marshal.GetLastWin32Error()); return 125; }
    if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
      { Console.Error.WriteLine("idle-launch: AssignProcessToJobObject failed " + Marshal.GetLastWin32Error()); return 125; }
    var rest = new StringBuilder();
    for (int i = 1; i < args.Length; i++) { if (i > 1) rest.Append(' '); rest.Append(Quote(args[i])); }
    var psi = new ProcessStartInfo(args[0], rest.ToString());
    psi.UseShellExecute = false;
    psi.WorkingDirectory = Environment.CurrentDirectory;
    var p = Process.Start(psi);
    p.WaitForExit();
    return p.ExitCode;
  }
}
`;

const toWindowsPath = (wslPath: string) =>
  execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();

/** PowerShell's -EncodedCommand: no quoting to get wrong. */
export const encodePowerShell = (command: string) =>
  Buffer.from(command, "utf16le").toString("base64");

/**
 * Makes `file` executable for WSL interop. Windows writes through \\wsl$
 * with mode 0644, and interop will not spawn a file without the exec bit
 * (`spawn … EACCES`).
 */
export const ensureExecutable = (file: string) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    fs.chmodSync(file, 0o755);
  }
};

/** Compiles `src` (C#) to `exe` with a PowerShell lowered to Idle on cores 6-9; csc inherits both. */
const buildLauncher = (src: string, exe: string) => {
  const command = [
    "$me = [Diagnostics.Process]::GetCurrentProcess()",
    `$me.ProcessorAffinity = [IntPtr]${AFFINITY_MASK}`,
    "$me.PriorityClass = 'Idle'",
    `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${toWindowsPath(src)}')) -OutputAssembly '${toWindowsPath(exe)}' -OutputType ConsoleApplication`,
  ].join("; ");
  const run = spawnSync(
    POWERSHELL,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShell(command),
    ],
    { cwd: "/mnt/c", encoding: "utf8", timeout: 120_000 }
  );
  if (!fs.existsSync(exe))
    throw new Error(
      `Could not build idle-launch.exe: ${run.stderr || run.stdout}`
    );
};

/**
 * `idle-launch.exe`, compiled on first use and kept, keyed by its source.
 * Always handed back executable, cached or freshly built.
 */
export const idleLauncher = ({
  dir = path.join(os.tmpdir(), "cvm-windows-guard"),
  build = buildLauncher,
}: {
  dir?: string;
  build?: (src: string, exe: string) => void;
} = {}): string => {
  const hash = createHash("sha256")
    .update(LAUNCHER_SOURCE)
    .digest("hex")
    .slice(0, 12);
  const exe = path.join(dir, `idle-launch-${hash}.exe`);
  if (!fs.existsSync(exe)) {
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, `idle-launch-${hash}.cs`);
    fs.writeFileSync(src, LAUNCHER_SOURCE);
    build(src, exe);
  }
  ensureExecutable(exe);
  return exe;
};

export type WindowsGuard = {
  /**
   * Starts a Windows program at Idle priority on cores 6-9. `exe` is its WSL
   * path (`/mnt/c/…`) or a name on Windows' PATH; `cwd` defaults to `/mnt/c`.
   * Killing the returned process kills the program too.
   */
  spawn: (
    exe: string,
    args: readonly string[],
    o?: { cwd?: string; stdio?: StdioOptions }
  ) => ChildProcess;
  /** Runs a PowerShell command (no file, no quoting) the same way. */
  powershell: (
    command: string,
    o?: { cwd?: string; stdio?: StdioOptions }
  ) => ChildProcess;
};

/**
 * Call before starting any Windows process. Refuses (prints every reason
 * and exits `REFUSED_EXIT_CODE`) while the recorder or OBS is running;
 * otherwise returns the only way to start one.
 */
export const guardWindows = (): WindowsGuard => {
  const reasons = checkWindows();
  if (reasons.length > 0) {
    console.error(
      [
        "windows-guard: refusing to start Windows processes while something is recording.",
        ...reasons.map((r) => `  - ${r}`),
        "A Windows process at any priority can cost a live take frames. Try again once Matt has closed the recorder and OBS.",
      ].join("\n")
    );
    process.exit(REFUSED_EXIT_CODE);
  }
  const launcher = idleLauncher();
  const start: WindowsGuard["spawn"] = (exe, args, o = {}) =>
    spawn(launcher, [exe.startsWith("/") ? toWindowsPath(exe) : exe, ...args], {
      cwd: o.cwd ?? "/mnt/c",
      stdio: o.stdio ?? ["pipe", "pipe", "pipe"],
    });
  return {
    spawn: start,
    powershell: (command, o) =>
      start(
        POWERSHELL,
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          encodePowerShell(command),
        ],
        o
      ),
  };
};

// `windows-guard --check` | `windows-guard [--] <exe> [args…]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  if (argv[0] === "--check" || argv.length === 0) {
    const reasons = checkWindows();
    for (const r of reasons) console.error(r);
    console.error(
      reasons.length > 0 ? "windows-guard: refuse" : "windows-guard: clear"
    );
    process.exit(reasons.length > 0 ? REFUSED_EXIT_CODE : 0);
  }
  const [exe, ...args] = argv;
  const child = guardWindows().spawn(exe!, args, {
    cwd: process.cwd().startsWith("/mnt/") ? process.cwd() : "/mnt/c",
    stdio: "inherit",
  });
  child.once("close", (code) => process.exit(code ?? 1));
}
