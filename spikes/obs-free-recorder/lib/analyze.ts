// Turns a run folder into report.md / report.json, judged against the stop criteria:
//   A/V drift <= 33 ms, camera/screen drift <= 33 ms, no dropped frames,
//   CPU/GPU <= ~1.5x the OBS baseline, <= ~25 GB/h.
// Drift is measured at each sync marker (white flash + 1 kHz beep): the onset
// is found in every stream, and the offsets between streams must not move.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toWindowsPath, windowsTool } from "./win.ts";
import { FILES } from "./recorder.ts";

export type Meta = {
  mode: "selftest" | "record" | "crash" | "baseline";
  t0Ms: number;
  startedWallMs: number;
  endedWallMs?: number;
  synthetic?: {
    period: number;
    camSpeed: number;
    micSpeed: number;
    noAudioCorrection: boolean;
  };
  logicalCpus: number;
  obsFile?: string;
  obsFileStartWallMs?: number;
  crash?: CrashResult;
};

export type CrashResult = {
  killedAtFileTime: number;
  files: {
    file: string;
    ok: boolean;
    duration: number;
    decodeErrors: number;
    lostSeconds: number;
  }[];
  pass: boolean;
};

const LIMIT_MS = 33;

// ---------- ffmpeg helpers ----------

function ffmpeg(args: string[], cwd: string) {
  const r = spawnSync(
    windowsTool("ffmpeg"),
    ["-hide_banner", "-nostats", ...args],
    {
      cwd,
      maxBuffer: 1 << 30,
    }
  );
  return { stdout: r.stdout as Buffer, stderr: String(r.stderr) };
}

export function probe(file: string) {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8", maxBuffer: 1 << 26 }
  );
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout) as {
    format: { duration?: string; size?: string };
    streams: Record<string, string | number>[];
  };
}

function lastPacketTime(file: string): number {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8", maxBuffer: 1 << 28 }
  );
  let end = 0;
  for (const line of r.stdout.split("\n")) {
    const [pts, dur] = line.split(",").map(Number);
    if (Number.isFinite(pts))
      end = Math.max(end, pts! + (Number.isFinite(dur) ? dur! : 0));
  }
  return end;
}

function countPackets(file: string): number {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "csv=p=0",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8" }
  );
  return Number(r.stdout.trim());
}

/** Mean luma of every frame in [from, from+dur), optionally inside a crop rect. */
function lumaSeries(file: string, from: number, dur: number, crop?: string) {
  const vf = [crop ? `crop=${crop}` : "", "scale=16:9:flags=area", "showinfo"]
    .filter(Boolean)
    .join(",");
  const { stderr } = ffmpeg(
    [
      "-copyts",
      "-ss",
      String(Math.max(0, from)),
      "-t",
      String(dur),
      "-i",
      path.basename(file),
      "-vf",
      vf,
      "-an",
      "-f",
      "null",
      "-",
    ],
    path.dirname(file)
  );
  const t: number[] = [];
  const v: number[] = [];
  for (const m of stderr.matchAll(/pts_time:\s*([\d.]+).*?mean:\[(\d+)/g)) {
    t.push(Number(m[1]));
    v.push(Number(m[2]));
  }
  return { t, v };
}

/** 1 kHz tone amplitude (Goertzel, 20 ms window, 1 ms hop) in [from, from+dur). */
function toneSeries(
  file: string,
  from: number,
  dur: number,
  startTime: number
) {
  const start = Math.max(0, from);
  const { stdout } = ffmpeg(
    [
      "-ss",
      String(start),
      "-t",
      String(dur),
      "-i",
      path.basename(file),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      "-",
    ],
    path.dirname(file)
  );
  const n = stdout.length >> 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = stdout.readInt16LE(i * 2) / 32768;
  const N = 160;
  const hop = 8;
  const coeff = 2 * Math.cos((2 * Math.PI * 1000) / 8000);
  const t: number[] = [];
  const v: number[] = [];
  for (let s = 0; s + N <= n; s += hop) {
    let q1 = 0;
    let q2 = 0;
    for (let i = 0; i < N; i++) {
      const q0 = coeff * q1 - q2 + x[s + i]!;
      q2 = q1;
      q1 = q0;
    }
    const power = q1 * q1 + q2 * q2 - coeff * q1 * q2;
    // Window END: the tone is fully inside the window from here on.
    t.push(startTime + start + (s + N) / 8000);
    v.push(Math.sqrt(Math.max(0, power)) / (N / 2));
  }
  return { t, v };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

/** Time where the series first crosses halfway from its pre-marker level to its peak (linear interpolation). */
function onset(
  series: { t: number[]; v: number[] },
  expected: number,
  minRise: number
): number | null {
  const pre = series.v.filter((_, i) => series.t[i]! < expected - 0.6);
  const base = median(pre.length >= 5 ? pre : series.v.slice(0, 10));
  const peak = Math.max(...series.v);
  if (!(peak - base >= minRise)) return null;
  const thr = base + 0.5 * (peak - base);
  for (let i = 1; i < series.v.length; i++) {
    const a = series.v[i - 1]!;
    const b = series.v[i]!;
    if (a < thr && b >= thr && series.t[i]! > expected - 0.6) {
      return (
        series.t[i - 1]! +
        ((thr - a) / (b - a)) * (series.t[i]! - series.t[i - 1]!)
      );
    }
  }
  return null;
}

// ---------- inputs ----------

const readJsonl = (file: string) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

function parseCsv(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((m) =>
    (m[1] ?? m[2] ?? "").trim()
  );
}

function stats(a: number[]) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    avg: s.reduce((x, y) => x + y, 0) / s.length,
    p50: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1]!,
    n: s.length,
  };
}

function perf(runDir: string, cpus: number) {
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

/**
 * Capture timing before the CFR step. Lost frames are counted as persistent
 * steps in the timing residual: a lost frame shifts every later frame by one
 * interval, while scheduling jitter (Windows' 15.6 ms timer, USB bursts) does
 * not accumulate. Rolling medians make the count immune to that jitter.
 */
function arrivals(file: string, nominalFps: number) {
  if (!fs.existsSync(file)) return null;
  const pts = [
    ...fs.readFileSync(file, "utf8").matchAll(/pts_time:([-\d.]+)/g),
  ].map((m) => Number(m[1]));
  const n = pts.length;
  if (n < 100) return null;
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push((pts[i]! - pts[i - 1]!) * 1000);
  // Measured period over the steady part (skip the first 3 s of start-up).
  const s0 = Math.min(n - 2, Math.round(3 * nominalFps));
  const T = (pts[n - 1]! - pts[s0]!) / (n - 1 - s0);
  const r = pts.map((p, i) => p - pts[s0]! - (i - s0) * T);
  const W = 15;
  const med: number[] = [];
  for (let i = 0; i < n; i++)
    med.push(median(r.slice(Math.max(0, i - W), Math.min(n, i + W + 1))));
  let lost = 0;
  let events = 0;
  for (let i = s0 + W; i < n - W; i++) {
    const step = med[i + W]! - med[i - W]!;
    if (step > 0.6 * T) {
      lost += Math.round(step / T);
      events++;
      i += 2 * W;
    }
  }
  return {
    frames: n,
    firstArrival: pts[0]!,
    lastArrival: pts[n - 1]!,
    measuredFps: Math.round((1 / T) * 1000) / 1000,
    clockPpm: Math.round((1 / T / nominalFps - 1) * 1e6),
    lostFrames: lost,
    lossEvents: events,
    intervalMs: stats(intervals),
  };
}

/**
 * How far the pipeline fell behind real time. ffmpeg's -progress `speed` is
 * media time / ffmpeg's own elapsed wall time, so elapsed = out_time / speed and
 * lag = elapsed - out_time. A pipeline that keeps up holds lag constant.
 */
function pipelineLag(runDir: string, name: string) {
  const rows = readJsonl(path.join(runDir, `progress-${name}.jsonl`))
    .map((p) => ({
      out: Number(p.out_time_us) / 1e6,
      speed: parseFloat(String(p.speed)),
    }))
    .filter((p) => p.out > 0 && p.speed > 0);
  if (rows.length < 15) return null;
  const lag = (p: { out: number; speed: number }) => p.out / p.speed - p.out;
  const base = lag(rows[10]!);
  const growth = rows.slice(10).map((p) => lag(p) - base);
  return {
    maxLagGrowthSec: Math.round(Math.max(...growth) * 100) / 100,
    endLagGrowthSec: Math.round(growth[growth.length - 1]! * 100) / 100,
  };
}

// ---------- markers ----------

type Marker = { label: string; expected: number; wallMs: number };

function markers(
  meta: Meta,
  events: Record<string, unknown>[],
  origin: number,
  duration: number
): Marker[] {
  const out: Marker[] = [];
  if (meta.synthetic) {
    const p = meta.synthetic.period * 1000;
    for (
      let w = Math.ceil((origin + 3000) / p) * p;
      w < origin + (duration - 3) * 1000;
      w += p
    ) {
      out.push({
        label: `wall ${new Date(w).toISOString().slice(11, 19)}`,
        expected: (w - origin) / 1000,
        wallMs: w,
      });
    }
  } else {
    for (const e of events) {
      if (e.type !== "flash") continue;
      const w = e.wallMs as number;
      const expected = (w - origin) / 1000;
      if (expected > 3 && expected < duration - 3) {
        out.push({
          label: `${e.reason ?? "flash"} ${new Date(w).toISOString().slice(11, 19)}`,
          expected,
          wallMs: w,
        });
      }
    }
  }
  return out;
}

// ---------- main ----------

export function analyze(runDir: string, baselineDir?: string): Report {
  const report = buildReport(runDir, baselineDir);
  fs.writeFileSync(
    path.join(runDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(path.join(runDir, "report.md"), toMarkdown(report));
  if (report.mode === "record" || report.mode === "crash")
    clapSheets(runDir, report.durationSec, report.micStart);
  return report;
}

type Report = ReturnType<typeof buildReport>;

function buildReport(runDir: string, baselineDir?: string) {
  const meta = JSON.parse(
    fs.readFileSync(path.join(runDir, "meta.json"), "utf8")
  ) as Meta;
  const events = readJsonl(path.join(runDir, "events.jsonl"));
  const isBaseline = meta.mode === "baseline";

  // Which file holds each stream, the region to look at, and where the file's t=0 sits on the wall clock.
  const obs = meta.obsFile;
  const src = isBaseline
    ? {
        screen: { file: obs!, crop: "1400:1080:0:0" }, // Code scene: screen, left of the face cam
        camera: { file: obs!, crop: "491:716:1429:364" }, // Code scene face cam (layouts.json)
        mic: obs!,
        origin: meta.obsFileStartWallMs!,
      }
    : {
        screen: { file: path.join(runDir, FILES.screen), crop: undefined },
        camera: { file: path.join(runDir, FILES.camera), crop: undefined },
        mic: path.join(runDir, FILES.mic),
        origin: meta.t0Ms,
      };

  const probes = {
    screen: probe(src.screen.file),
    camera: isBaseline ? null : probe(src.camera.file),
    mic: isBaseline ? null : probe(src.mic),
  };
  const duration = Number(probes.screen?.format.duration ?? 0);
  const micStart = Number(
    (isBaseline ? probes.screen : probes.mic)?.streams.find(
      (s) => s.codec_type === "audio"
    )?.start_time ?? 0
  );

  // Sync markers
  const rows = markers(meta, events, src.origin, duration).map((m) => {
    const from = m.expected - 2;
    const screen = onset(
      lumaSeries(src.screen.file, from, 4, src.screen.crop),
      m.expected,
      25
    );
    const camera = onset(
      lumaSeries(src.camera.file, from, 4, src.camera.crop),
      m.expected,
      8
    );
    const audio = onset(
      toneSeries(src.mic, from, 4, micStart),
      m.expected,
      0.002
    );
    const ms = (a: number | null, b: number | null) =>
      a === null || b === null ? null : Math.round((a - b) * 10000) / 10;
    return {
      marker: m.label,
      expected: Math.round(m.expected * 1000) / 1000,
      screen,
      camera,
      audio,
      camMinusScreenMs: ms(camera, screen),
      audioMinusScreenMs: ms(audio, screen),
      audioMinusCameraMs: ms(audio, camera),
    };
  });
  // A device clock that runs fast or slow is retimed to CFR by dropping or
  // repeating a whole frame, so the camera's offset saw-tooths within one frame
  // (33 ms) without accumulating. Drift is therefore judged as the furthest any
  // marker strays from the run's median offset; range and linear trend are shown too.
  const drift = (
    key: "camMinusScreenMs" | "audioMinusScreenMs" | "audioMinusCameraMs"
  ) => {
    const pts = rows
      .filter((r) => r[key] !== null)
      .map((r) => ({ t: r.expected, v: r[key] as number }));
    if (pts.length < 2)
      return {
        n: pts.length,
        medianMs: pts[0]?.v ?? null,
        maxDevMs: null as number | null,
        rangeMs: null,
        trendMs: null,
      };
    const vals = pts.map((p) => p.v);
    const med = median(vals);
    const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
    const mv = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    const slope =
      pts.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) /
      (pts.reduce((a, p) => a + (p.t - mt) ** 2, 0) || 1);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    return {
      n: pts.length,
      medianMs: r1(med),
      maxDevMs: r1(Math.max(...vals.map((v) => Math.abs(v - med)))),
      rangeMs: r1(Math.max(...vals) - Math.min(...vals)),
      trendMs: r1(slope * (pts[pts.length - 1]!.t - pts[0]!.t)),
    };
  };
  const sync = {
    camMinusScreen: drift("camMinusScreenMs"),
    audioMinusScreen: drift("audioMinusScreenMs"),
    audioMinusCamera: drift("audioMinusCameraMs"),
  };

  // Frames
  // The screen is captured on change (VFR) by design, so only the camera can lose frames at
  // capture; the screen can only lose them by the pipeline falling behind (lag).
  const frames = isBaseline
    ? null
    : {
        screen: {
          arrivals: arrivals(path.join(runDir, FILES.screenArrivals), 60),
          written: countPackets(src.screen.file),
          expected: Math.round(duration * 60),
        },
        camera: {
          arrivals: arrivals(
            path.join(runDir, FILES.cameraArrivals),
            30000 / 1001
          ),
          written: countPackets(src.camera.file),
          expected: Math.round((duration * 30000) / 1001),
        },
        pipeline: {
          screen: pipelineLag(runDir, "screen"),
          camera: pipelineLag(runDir, "camera"),
        },
      };
  const log = ["ffmpeg-screen.log", "ffmpeg-camera.log"]
    .map((f) => path.join(runDir, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  const logWarnings = log
    .split("\n")
    .filter((l) =>
      /real-time buffer|dropp|Past duration|Non-monotonic|\[error\]|\[fatal\]/i.test(
        l
      )
    );

  // Size
  const files = isBaseline
    ? [obs!]
    : [src.screen.file, src.camera.file, src.mic];
  const bytes = files.reduce(
    (n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0),
    0
  );
  const gbPerHour = duration > 0 ? bytes / 1e9 / (duration / 3600) : null;

  // Preview latency (page decodes the on-screen ms clock from the preview it received)
  const latencySamples = events
    .filter((e) => e.type === "latency")
    .flatMap((e) => e.samples as number[]);
  const latency = stats(latencySamples);

  const resources = perf(runDir, meta.logicalCpus || 32);
  let baseline: ReturnType<typeof perf> | null = null;
  if (baselineDir && fs.existsSync(path.join(baselineDir, "meta.json"))) {
    const bm = JSON.parse(
      fs.readFileSync(path.join(baselineDir, "meta.json"), "utf8")
    ) as Meta;
    baseline = perf(baselineDir, bm.logicalCpus || 32);
  }
  const ratio = (a?: { avg: number } | null, b?: { avg: number } | null) =>
    a && b && b.avg > 0 ? Math.round((a.avg / b.avg) * 100) / 100 : null;
  const comparison = baseline
    ? {
        baselineDir,
        cpuTotal: ratio(resources.cpuTotalPct, baseline.cpuTotalPct),
        gpu: ratio(resources.gpuPct, baseline.gpuPct),
        nvenc: ratio(resources.nvencPct, baseline.nvencPct),
        recorderProcessCpu: ratio(resources.cpuFfmpegPct, baseline.cpuObsPct),
      }
    : null;

  // Verdicts
  const within = (d: { maxDevMs: number | null; n: number }) =>
    d.n < 2
      ? "n/a (fewer than 2 markers found)"
      : d.maxDevMs! <= LIMIT_MS
        ? "PASS"
        : "FAIL";
  const captureDrops = frames
    ? (frames.camera.arrivals?.lostFrames ?? 0) +
      Object.values(frames.pipeline).filter((p) => p && p.maxLagGrowthSec > 0.5)
        .length
    : null;
  const verdicts: Record<string, string> = {
    "A/V drift <= 33 ms": within(sync.audioMinusScreen),
    "camera/screen drift <= 33 ms": within(sync.camMinusScreen),
    "no dropped frames":
      captureDrops === null
        ? "n/a (OBS: see its log)"
        : captureDrops === 0 &&
            !logWarnings.some((l) => /real-time buffer|dropp/i.test(l))
          ? "PASS"
          : "FAIL",
    "CPU/GPU <= 1.5x OBS": !comparison
      ? "n/a (no baseline run to compare with)"
      : Math.max(comparison.cpuTotal ?? 0, comparison.gpu ?? 0) <= 1.5
        ? "PASS"
        : "FAIL",
    "<= 25 GB/h":
      gbPerHour === null ? "n/a" : gbPerHour <= 25 ? "PASS" : "FAIL",
  };
  if (meta.crash)
    verdicts["kill -9 recovery (<= 2 s lost)"] = meta.crash.pass
      ? "PASS"
      : "FAIL";

  const report = {
    runDir,
    mode: meta.mode,
    synthetic: meta.synthetic ?? null,
    durationSec: Math.round(duration * 10) / 10,
    micStart,
    verdicts,
    sync,
    markers: rows,
    frames,
    logWarnings: logWarnings.slice(0, 20),
    sizeGB: Math.round(bytes / 1e7) / 100,
    gbPerHour: gbPerHour === null ? null : Math.round(gbPerHour * 10) / 10,
    previewLatencyMs: latency,
    resources,
    comparison,
    crash: meta.crash ?? null,
    formats: Object.fromEntries(
      Object.entries(probes).map(([k, p]) => [
        k,
        p?.streams.map((s) =>
          Object.fromEntries(
            [
              "codec_name",
              "profile",
              "pix_fmt",
              "width",
              "height",
              "r_frame_rate",
              "sample_rate",
              "channels",
              "color_space",
              "color_range",
              "start_time",
            ]
              .filter((f) => s[f] !== undefined)
              .map((f) => [f, s[f]])
          )
        ),
      ])
    ),
  };
  return report;
}

// Matt claps on camera at the start and end. The loudest transient in the
// first/last 2 minutes is found in the mic file, and a strip of camera frames
// around it is saved so the hands-meet frame can be read off by eye.
function clapSheets(runDir: string, duration: number, micStart: number) {
  for (const [name, from] of [
    ["start", 0],
    ["end", Math.max(0, duration - 120)],
  ] as const) {
    const { stdout } = ffmpeg(
      // High-pass at 3 kHz: a clap is broadband, the sync beep is a pure 1 kHz tone.
      [
        "-ss",
        String(from),
        "-t",
        "120",
        "-i",
        FILES.mic,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        "highpass=f=3000:poles=2,highpass=f=3000:poles=2",
        "-f",
        "s16le",
        "-",
      ],
      runDir
    );
    let best = 0;
    let at = -1;
    for (let i = 0; i < stdout.length >> 1; i++) {
      const v = Math.abs(stdout.readInt16LE(i * 2));
      if (v > best) {
        best = v;
        at = i;
      }
    }
    if (at < 0) continue;
    const t = micStart + from + at / 16000;
    fs.writeFileSync(
      path.join(runDir, `clap-${name}.txt`),
      `loudest transient at file time ${t.toFixed(3)} s\n`
    );
    ffmpeg(
      [
        "-copyts",
        "-ss",
        String(Math.max(0, t - 0.2)),
        "-i",
        FILES.camera,
        "-frames:v",
        "1",
        "-fps_mode",
        "passthrough",
        "-vf",
        "scale=320:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1,tile=13x1:padding=2",
        "-update",
        "1",
        "-y",
        `clap-${name}.png`,
      ],
      runDir
    );
  }
}

function toMarkdown(r: Report): string {
  const lines = [
    `# Rig report: ${r.mode}${r.synthetic ? " (synthetic sources)" : ""}`,
    "",
    `Run: \`${r.runDir}\` (Windows: \`${safeWin(r.runDir)}\`), ${r.durationSec} s recorded.`,
    "",
    "## Stop criteria",
    "",
    "| Criterion | Result |",
    "|---|---|",
    ...Object.entries(r.verdicts).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Sync at each marker (ms, onset of flash/beep)",
    "",
    "| Marker | file time (s) | camera - screen | audio - screen | audio - camera |",
    "|---|---|---|---|---|",
    ...r.markers.map(
      (m) =>
        `| ${m.marker} | ${m.expected} | ${m.camMinusScreenMs ?? "–"} | ${m.audioMinusScreenMs ?? "–"} | ${m.audioMinusCameraMs ?? "–"} |`
    ),
    "",
    "| Pair | markers | median offset | max deviation from median (judged) | range | linear trend over run |",
    "|---|---|---|---|---|---|",
    ...(
      [
        ["camera - screen", r.sync.camMinusScreen],
        ["audio - screen", r.sync.audioMinusScreen],
        ["audio - camera", r.sync.audioMinusCamera],
      ] as const
    ).map(
      ([k, d]) =>
        `| ${k} | ${d.n} | ${d.medianMs ?? "–"} | ${d.maxDevMs ?? "–"} | ${d.rangeMs ?? "–"} | ${d.trendMs ?? "–"} |`
    ),
    "",
    "The median offset is a constant (device latency, packetisation) to calibrate once; only movement around it is drift.",
    "",
    "## Frames",
    "",
    "```json",
    JSON.stringify(r.frames, null, 1),
    "```",
    r.logWarnings.length
      ? `ffmpeg log warnings (first 20):\n\n\`\`\`\n${r.logWarnings.join("\n")}\n\`\`\``
      : "No drop/buffer warnings in the ffmpeg log.",
    "",
    "## Resources, size, latency",
    "",
    `- Size: ${r.sizeGB} GB, **${r.gbPerHour} GB/h**`,
    `- Preview latency (ms clock, glass to page): ${r.previewLatencyMs ? `p50 ${r.previewLatencyMs.p50} / p95 ${r.previewLatencyMs.p95} ms over ${r.previewLatencyMs.n} frames` : "n/a"}`,
    "",
    "```json",
    JSON.stringify(
      { resources: r.resources, comparison: r.comparison },
      null,
      1
    ),
    "```",
    "",
    r.crash
      ? `## kill -9 recovery\n\n\`\`\`json\n${JSON.stringify(r.crash, null, 1)}\n\`\`\``
      : "",
    "## Formats",
    "",
    "```json",
    JSON.stringify(r.formats, null, 1),
    "```",
    "",
  ];
  return lines.join("\n");
}

function safeWin(p: string) {
  try {
    return toWindowsPath(p);
  } catch {
    return p;
  }
}

/** Opens each recorded file after a hard kill: it must decode cleanly and stop no more than 2 s before the kill. */
export function checkRecovery(
  runDir: string,
  killedAtFileTime: number
): CrashResult {
  const files = [FILES.screen, FILES.camera, FILES.mic].map((f) => {
    const p = probe(path.join(runDir, f));
    const duration = lastPacketTime(path.join(runDir, f));
    const { stderr } = ffmpeg(
      ["-v", "error", "-i", f, "-f", "null", "-"],
      runDir
    );
    const decodeErrors = stderr.split("\n").filter((l) => l.trim()).length;
    const lostSeconds = Math.round((killedAtFileTime - duration) * 100) / 100;
    return {
      file: f,
      ok: !!p && duration > 0,
      duration,
      decodeErrors,
      lostSeconds,
    };
  });
  return {
    killedAtFileTime,
    files,
    pass: files.every(
      (f) => f.ok && f.lostSeconds <= 2 && f.decodeErrors === 0
    ),
  };
}
