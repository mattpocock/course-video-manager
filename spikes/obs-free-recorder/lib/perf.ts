// CPU and GPU use over a run, from the Windows performance counters and
// nvidia-smi samples the collector writes (collector.ts).
import fs from "node:fs";
import path from "node:path";
import { stats } from "./judge.ts";

function parseCsv(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((m) =>
    (m[1] ?? m[2] ?? "").trim()
  );
}

/** typeperf's CSV: header names and rows of numbers (blank or bad cells NaN). */
function readTypeperf(file: string) {
  if (!fs.existsSync(file)) return null;
  const lines = fs
    .readFileSync(file, "utf8")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.startsWith('"'));
  const header = parseCsv(lines[0] ?? "");
  const rows = lines
    .slice(1)
    .map((l) => parseCsv(l).map((x) => (x === "" ? NaN : Number(x))));
  return { header, rows };
}

/**
 * Total CPU counters, in order of preference. typeperf silently leaves a
 * counter out of the whole run when its first sample fails: on the rig PC
 * \Processor(_Total) went missing in 7 of 22 runs (header only, no error),
 * among them the 2026-10-11 baseline. The collector now samples both in a
 * process of their own (perf-cpu-total.csv) and restarts it until one is there.
 */
export const TOTAL_CPU_COLUMN =
  /\\(Processor|Processor Information)\(_Total\)\\% Processor Time$/;

export const CPU_TOTAL_FILE = "perf-cpu-total.csv";

/** Total CPU % per sample from whichever file has a total column, else why it's missing. */
export function totalCpu(runDir: string): {
  samples: number[];
  missing?: string;
} {
  const tried: string[] = [];
  for (const f of [CPU_TOTAL_FILE, "perf-cpu.csv"]) {
    const t = readTypeperf(path.join(runDir, f));
    if (!t) {
      tried.push(`no ${f}`);
      continue;
    }
    // Processor(_Total) first, Processor Information(_Total) as the fallback.
    const cols = t.header
      .map((h, i) => ({ h, i }))
      .filter((x) => TOTAL_CPU_COLUMN.test(x.h))
      .sort(
        (a, b) =>
          Number(/Information/.test(a.h)) - Number(/Information/.test(b.h))
      );
    if (!cols.length) {
      tried.push(
        `${f} has no _Total column (typeperf dropped the counter at start)`
      );
      continue;
    }
    const samples = t.rows.flatMap((r) => {
      const v = cols
        .map((c) => r[c.i]!)
        .find((x) => Number.isFinite(x) && x >= 0 && x <= 100);
      return v === undefined ? [] : [v];
    });
    if (samples.length) return { samples };
    tried.push(`${f}: no valid _Total samples`);
  }
  return { samples: [], missing: tried.join("; ") };
}

export function perf(runDir: string, cpus: number) {
  const cpu: Record<string, number[]> = {
    ffmpeg: [],
    obs64: [],
    chrome: [],
  };
  const total = totalCpu(runDir);
  const t = readTypeperf(path.join(runDir, "perf-cpu.csv"));
  if (t) {
    // Every instance of a process (ffmpeg, ffmpeg#1, …) is summed.
    const cols: Record<string, number[]> = {
      ffmpeg: t.header.flatMap((h, i) =>
        /Process\(ffmpeg(#\d+)?\)/.test(h) ? [i] : []
      ),
      obs64: t.header.flatMap((h, i) =>
        /Process\(obs64(#\d+)?\)/.test(h) ? [i] : []
      ),
      chrome: t.header.flatMap((h, i) =>
        /Process\(chrome(#\d+)?\)/.test(h) ? [i] : []
      ),
    };
    for (const row of t.rows) {
      for (const [k, idx] of Object.entries(cols)) {
        if (!idx.length) continue;
        const vals = idx
          .map((i) => row[i]!)
          // A process exiting mid-sample can read thousands of %: not a sample.
          .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100 * cpus);
        if (!vals.length) continue;
        cpu[k]!.push(vals.reduce((a, b) => a + b, 0) / cpus);
      }
    }
  }
  const gpu: Record<string, number[]> = {
    gpu: [],
    enc: [],
    dec: [],
    vramMiB: [],
  };
  const gpuFile = path.join(runDir, "perf-gpu.csv");
  const gpuMissing = fs.existsSync(gpuFile) ? null : "no perf-gpu.csv";
  if (fs.existsSync(gpuFile)) {
    for (const line of fs
      .readFileSync(gpuFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .slice(1)) {
      const r = line.split(",").map((s) => Number(s.trim()));
      if (r.length < 5 || !Number.isFinite(r[1])) continue;
      gpu.gpu!.push(r[1]!);
      gpu.enc!.push(r[2]!);
      gpu.dec!.push(r[3]!);
      gpu.vramMiB!.push(r[4]!);
    }
  }
  return {
    cpuTotalPct: stats(total.samples),
    /** Why total CPU has no samples (the verdict says so instead of reading 0). */
    cpuTotalMissing: total.missing ?? null,
    cpuFfmpegPct: stats(cpu.ffmpeg!),
    cpuObsPct: stats(cpu.obs64!),
    cpuChromePct: stats(cpu.chrome!),
    gpuPct: stats(gpu.gpu!),
    gpuMissing: gpu.gpu!.length
      ? null
      : (gpuMissing ?? "perf-gpu.csv has no samples"),
    nvencPct: stats(gpu.enc!),
    vramMiB: stats(gpu.vramMiB!),
  };
}
