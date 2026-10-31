import http from "node:http";
import { RECORDER_SERVICE_PORT } from "../../recorder-service/protocol";
import fs from "node:fs";
import {
  AFFINITY_MASK,
  reasonsToRefuse,
  type WindowsGuard,
} from "../windows-guard";

/**
 * The scorecard's reach into Windows: its own ffmpeg.exe processes (found by
 * the run's marker in their command line, and nothing else), the GPU, the
 * Windows wall clock, and whether Matt is filming. Every Windows process
 * here starts through the Windows guard (`scripts/windows-guard.ts`): Idle
 * priority on cores 6-9, and none at all while anything records. Read-only, except
 * `killMarked` and `freezeMarked`, which only ever stop or freeze an
 * ffmpeg.exe carrying this run's marker.
 */

const NVIDIA_SMI = "C:\\Windows\\System32\\nvidia-smi.exe";

let guard: WindowsGuard | undefined;
/** The guard this process got from `guardWindows()`: the only way to start a Windows process. */
export const useGuard = (g: WindowsGuard) => {
  guard = g;
};
export const windowsGuard = () => {
  if (!guard)
    throw new Error("No Windows guard: no Windows process may start.");
  return guard;
};

const spawnPowerShell = (command: string) =>
  windowsGuard().powershell(command, { stdio: ["ignore", "pipe", "pipe"] });

export const runPowerShell = (command: string, timeoutMs = 30_000) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawnPowerShell(
        `$ProgressPreference = 'SilentlyContinue'; ${command}`
      );
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.once("error", (e) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: e.message });
      });
    }
  );

/** A marker or tag as a PowerShell single-quoted literal; refuses anything unexpected. */
const literal = (s: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(s))
    throw new Error(`Refusing an unexpected process marker: ${s}`);
  return `'${s}'`;
};

const marked = (marker: string) =>
  `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like ('*' + ${literal(marker)} + '*') }`;

/**
 * Stops this run's ffmpeg.exe processes: every one with `marker`, or only
 * those that also carry one of `tags`. Returns how many it stopped.
 */
export const killMarked = async (marker: string, tags?: readonly string[]) => {
  const tagFilter = tags?.length
    ? `| Where-Object { $cl = $_.CommandLine; @(${tags.map(literal).join(",")}) | Where-Object { $cl -like ('*' + $_ + '*') } }`
    : "";
  const { stdout } = await runPowerShell(
    `$p = @(${marked(marker)} ${tagFilter}); foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count`
  );
  return Number(stdout.trim()) || 0;
};

/**
 * Freezes this run's ffmpeg.exe processes that carry one of `tags` for `ms`,
 * then lets them go on (`NtSuspendProcess`, in the one PowerShell, so a
 * freeze always ends). Returns how many it froze. What a stream that falls
 * behind its feeds looks like to them (#2502): their sockets fill, and each
 * feed's fifo gives up on its connection after its 2 s timeout.
 */
export const freezeMarked = async (
  marker: string,
  tags: readonly string[],
  ms: number
) => {
  const { stdout } = await runPowerShell(
    [
      `Add-Type -Namespace CvmScorecard -Name Freeze -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'`,
      `$p = @(${marked(marker)} | Where-Object { $cl = $_.CommandLine; @(${tags.map(literal).join(",")}) | Where-Object { $cl -like ('*' + $_ + '*') } } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })`,
      `try { foreach ($x in $p) { [void][CvmScorecard.Freeze]::NtSuspendProcess($x.Handle) }; Start-Sleep -Milliseconds ${Math.round(ms)} } finally { foreach ($x in $p) { [void][CvmScorecard.Freeze]::NtResumeProcess($x.Handle) } }`,
      "$p.Count",
    ].join("; "),
    ms + 30_000
  );
  return Number(stdout.trim().split(/\r?\n/).at(-1)) || 0;
};

/**
 * Stops every ffmpeg.exe this run started (by its marker); each one's
 * idle-launch.exe ends with it. Returns how many it stopped.
 */
export const killRun = (marker: string) => killMarked(marker);

export type ProcessSample = {
  atMs: number;
  processes: {
    pid: number;
    cpu100ns: number;
    workingSet: number;
    /** Its priority class and affinity mask, as Windows has them now. */
    priority: string;
    affinity: number;
    /** Its `comment=` tag (`cvm-recorder-…`). */
    tag: string;
  }[];
};

/** This run's ffmpeg.exe processes: CPU time so far, working set, priority, affinity. */
export const sampleMarked = async (marker: string): Promise<ProcessSample> => {
  const { stdout } = await runPowerShell(
    `${marked(marker)} | ForEach-Object { $g = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($g) { $tag = [regex]::Match($_.CommandLine, 'comment=(cvm-recorder-[A-Za-z0-9-]+)').Groups[1].Value; "$($_.ProcessId)\`t$($_.KernelModeTime + $_.UserModeTime)\`t$($_.WorkingSetSize)\`t$($g.PriorityClass)\`t$([int64]$g.ProcessorAffinity)\`t$tag" } }`
  );
  return {
    atMs: Date.now(),
    processes: stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, cpu, ws, priority, affinity, tag] = line.split("\t");
        return {
          pid: Number(pid),
          cpu100ns: Number(cpu),
          workingSet: Number(ws),
          priority: priority ?? "",
          affinity: Number(affinity),
          tag: tag ?? "",
        };
      }),
  };
};

type SampledProcess = ProcessSample["processes"][number];

/**
 * A read that came back empty: Windows gave no priority class, or no affinity
 * mask. A process that is exiting (one the run has just killed) reads this
 * way, so it says nothing about how the process was started.
 */
const unread = (p: SampledProcess) =>
  p.priority === "" || !Number.isFinite(p.affinity) || p.affinity === 0;

const offIdle = (p: SampledProcess) =>
  p.priority !== "Idle" || p.affinity !== AFFINITY_MASK;

/**
 * The processes of the run that are not at Idle on cores 6-9: none, or the
 * run stops. A process whose read came back empty is read again
 * (`resample`): gone by then, it is ignored; still there, it counts, whether
 * it now reads off Idle or still reads empty. Every process that read
 * properly is judged on the first read.
 */
export const notIdle = async (
  sample: ProcessSample,
  resample: () => Promise<ProcessSample>
) => {
  const off = sample.processes.filter((p) => !unread(p) && offIdle(p));
  const unreadPids = new Set(sample.processes.filter(unread).map((p) => p.pid));
  if (unreadPids.size === 0) return off;
  const again = await resample();
  return [
    ...off,
    ...again.processes.filter((p) => unreadPids.has(p.pid) && offIdle(p)),
  ];
};

export const logicalCpus = async () =>
  Number(
    (
      await runPowerShell(
        "(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors"
      )
    ).stdout.trim()
  ) || 1;

/** Average CPU of the processes in both samples, as % of the whole machine; and their working set at the end (MB). */
export const cpuBetween = (
  a: ProcessSample,
  b: ProcessSample,
  cpus: number
) => {
  const before = new Map(a.processes.map((p) => [p.pid, p.cpu100ns]));
  let cpu100ns = 0;
  for (const p of b.processes) {
    const was = before.get(p.pid);
    if (was !== undefined) cpu100ns += p.cpu100ns - was;
  }
  const wallMs = Math.max(1, b.atMs - a.atMs);
  return {
    cpuPctOfMachine: (cpu100ns / 1e4 / wallMs / cpus) * 100,
    cpuCores: cpu100ns / 1e4 / wallMs,
    workingSetMb:
      b.processes.reduce((s, p) => s + p.workingSet, 0) / (1024 * 1024),
    processes: b.processes.length,
  };
};

export type GpuReading = {
  gpuPct: number;
  encoderPct: number;
  memoryMb: number;
};

/** The whole GPU, read every 500 ms for `ms`; the averages. */
export const sampleGpu = async (ms: number): Promise<GpuReading | null> => {
  const { stdout } = await runPowerShell(
    `$end = (Get-Date).AddMilliseconds(${Math.round(ms)}); while ((Get-Date) -lt $end) { & '${NVIDIA_SMI}' --query-gpu=utilization.gpu,utilization.encoder,memory.used --format=csv,noheader,nounits; Start-Sleep -Milliseconds 500 }`,
    ms + 30_000
  );
  const readings = stdout
    .split(/\r?\n/)
    .map((line) => line.split(",").map((x) => Number(x.trim())))
    .filter((r) => r.length === 3 && r.every((x) => Number.isFinite(x)));
  if (readings.length === 0) return null;
  const avg = (i: number) =>
    readings.reduce((s, r) => s + r[i]!, 0) / readings.length;
  return { gpuPct: avg(0), encoderPct: avg(1), memoryMb: avg(2) };
};

/**
 * Windows wall time less WSL's (`Date.now()`), in ms. A tick is printed
 * before it is read, so each says too little by how late it was read: the
 * largest of a second's worth is the closest.
 */
export const windowsClockOffset = () =>
  new Promise<number>((resolve, reject) => {
    const child = spawnPowerShell(
      "for ($i = 0; $i -lt 60; $i++) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 15 }"
    );
    let best = -Infinity;
    let buffer = "";
    child.stdout?.on("data", (d: Buffer) => {
      const at = Date.now();
      buffer += d.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const v = Number(line);
        if (Number.isFinite(v) && v > 0) best = Math.max(best, v - at);
      }
    });
    child.once("close", () =>
      Number.isFinite(best)
        ? resolve(best)
        : reject(new Error("Could not read the Windows clock"))
    );
  });

/** What Matt's own recorder service (port 5177) is doing, from its /health. */
export const liveRecorderState = () =>
  new Promise<"recording" | "open" | "closed">((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: RECORDER_SERVICE_PORT,
        path: "/health",
        timeout: 2000,
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () =>
          resolve(
            /"kind":"recording"/.test(body)
              ? "recording"
              : /"kind":"open"/.test(body)
                ? "open"
                : "closed"
          )
        );
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve("closed"));
  });

/** Whether OBS is running on Windows. */
export const obsRunning = async () =>
  (
    await runPowerShell(
      "@(Get-Process -Name obs64,obs32,obs -ErrorAction SilentlyContinue).Count"
    )
  ).stdout.trim() !== "0";

/** Linux-side command lines, from /proc. Starts nothing. */
const commandLines = () =>
  fs.readdirSync("/proc").flatMap((pid) => {
    if (!/^\d+$/.test(pid)) return [];
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return raw ? [raw.split("\0").join(" ").trim()] : [];
    } catch {
      return [];
    }
  });

/**
 * The guard's Linux-side reasons to refuse, the run's own processes left
 * out: Matt's recorder service started, or a recorder ffmpeg.exe not ours.
 */
export const foreignRecorderReasons = (marker: string) =>
  reasonsToRefuse({
    linux: commandLines().filter((c) => !c.includes(marker)),
  });

/** Whether any ffmpeg.exe of the run still shows on the Linux side. */
export const runProcessesLeft = (marker: string) =>
  commandLines().some((c) => c.includes(marker) && /\.exe\b/i.test(c));
