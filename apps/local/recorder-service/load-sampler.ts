import fs from "node:fs";

/**
 * LOAD SAMPLES (the capture stalls of 2026-10-15). While the camera capture
 * runs, `load-sampler.ps1` prints the PC's load once a second; each Recording
 * Session writes the samples into its `ffmpeg-capture.log`, beside the mic
 * stalls and DirectShow's dropped frames, so the next drop can be explained:
 * the whole machine's CPU, the capture's own, WSL's (Linux ffmpeg, Whisper's
 * neighbours) and the GPU's.
 */

/** One `load-sampler.ps1` line, with WSL's CPU beside it. */
export type LoadSample = {
  cpuPct: number;
  capturePct: number;
  captureCores: number;
  gpuPct: number | null;
  encoderPct: number | null;
  decoderPct: number | null;
  /** WSL's own CPU, % of its CPUs; null before a second reading. */
  wslPct: number | null;
};

const percent = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** A `load-sampler.ps1` line (tab-separated); undefined for anything else. */
export const parseLoadLine = (
  line: string
): Omit<LoadSample, "wslPct"> | undefined => {
  const [cpu, capture, cores, gpu, encoder, decoder] = line.trim().split("\t");
  const cpuPct = percent(cpu);
  const capturePct = percent(capture);
  const captureCores = percent(cores);
  if (cpuPct === null || capturePct === null || captureCores === null)
    return undefined;
  return {
    cpuPct,
    capturePct,
    captureCores,
    gpuPct: percent(gpu),
    encoderPct: percent(encoder),
    decoderPct: percent(decoder),
  };
};

const pct = (n: number | null) => (n === null ? "?" : `${Math.round(n)}%`);

/** The sample as one line of the capture's log. */
export const formatLoad = (atMs: number, s: LoadSample) =>
  `[load] ${new Date(atMs).toISOString()} cpu ${pct(s.cpuPct)} capture ${s.capturePct.toFixed(1)}% (${s.captureCores.toFixed(2)} cores) wsl ${pct(s.wslPct)} gpu ${pct(s.gpuPct)} enc ${pct(s.encoderPct)} dec ${pct(s.decoderPct)}`;

/**
 * WSL's CPU since the last call, from /proc/stat's `cpu` line: % of all its
 * CPUs busy. The first call (or an unreadable file) answers null.
 */
export const wslCpu = (
  read: () => string = () => fs.readFileSync("/proc/stat", "utf8")
) => {
  let last: { busy: number; total: number } | undefined;
  return (): number | null => {
    let line: string | undefined;
    try {
      line = read()
        .split("\n")
        .find((l) => l.startsWith("cpu "));
    } catch {
      return null;
    }
    if (!line) return null;
    const ticks = line.trim().split(/\s+/).slice(1).map(Number);
    const total = ticks.reduce((sum, t) => sum + t, 0);
    // idle + iowait
    const busy = total - (ticks[3] ?? 0) - (ticks[4] ?? 0);
    const before = last;
    last = { busy, total };
    if (!before || total <= before.total) return null;
    return ((busy - before.busy) / (total - before.total)) * 100;
  };
};
