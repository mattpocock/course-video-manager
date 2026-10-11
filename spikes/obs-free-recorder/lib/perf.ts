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

export function perf(runDir: string, cpus: number) {
  const cpu: Record<string, number[]> = {
    total: [],
    ffmpeg: [],
    obs64: [],
    chrome: [],
  };
  const cpuFile = path.join(runDir, "perf-cpu.csv");
  if (fs.existsSync(cpuFile)) {
    const lines = fs
      .readFileSync(cpuFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter((l) => l.startsWith('"'));
    const header = parseCsv(lines[0] ?? "");
    // Every instance of a process (ffmpeg, ffmpeg#1, …) is summed.
    const cols: Record<string, number[]> = {
      total: header.flatMap((h, i) =>
        /Processor\(_Total\)/.test(h) ? [i] : []
      ),
      ffmpeg: header.flatMap((h, i) =>
        /Process\(ffmpeg(#\d+)?\)/.test(h) ? [i] : []
      ),
      obs64: header.flatMap((h, i) =>
        /Process\(obs64(#\d+)?\)/.test(h) ? [i] : []
      ),
      chrome: header.flatMap((h, i) =>
        /Process\(chrome(#\d+)?\)/.test(h) ? [i] : []
      ),
    };
    for (const line of lines.slice(1)) {
      const row = parseCsv(line);
      for (const [k, idx] of Object.entries(cols)) {
        if (!idx.length) continue;
        const vals = idx
          .map((i) => Number(row[i]))
          .filter((n) => Number.isFinite(n) && n >= 0);
        if (!vals.length) continue;
        const sum = vals.reduce((a, b) => a + b, 0);
        cpu[k]!.push(k === "total" ? sum : sum / cpus);
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
    cpuTotalPct: stats(cpu.total!),
    cpuFfmpegPct: stats(cpu.ffmpeg!),
    cpuObsPct: stats(cpu.obs64!),
    cpuChromePct: stats(cpu.chrome!),
    gpuPct: stats(gpu.gpu!),
    nvencPct: stats(gpu.enc!),
    vramMiB: stats(gpu.vramMiB!),
  };
}
