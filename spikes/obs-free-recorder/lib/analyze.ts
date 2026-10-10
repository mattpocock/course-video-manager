// Turns a run folder into report.md / report.json, judged against the stop criteria:
//   A/V, camera/screen and lip-sync drift <= 33 ms, no dropped frames or stalls,
//   the recorder keeping up, live preview feeds, CPU/GPU <= ~1.5x the OBS
//   baseline, <= ~25 GB/h. The rules themselves live in judge.ts.
// Drift is measured at each sync marker (white flash + 1 kHz beep): the onset
// is found in every stream, and the offsets between streams must not move.
import fs from "node:fs";
import path from "node:path";
import { toMarkdown } from "./report-md.ts";
import { countPackets, ffmpeg, lastPacketTime, probe } from "./ff.ts";
import type { CrashResult } from "./recovery.ts";
import { FILES } from "./recorder.ts";
import {
  arrivalsFromPts,
  cfrShift,
  frameVerdicts,
  judgeSync,
  lagFromRows,
  median,
  previewVerdict,
  stats,
  type PreviewStats,
} from "./judge.ts";

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
    realScreen?: boolean;
    /** Where the on-screen marker square sits in the captured output (ffmpeg crop w:h:x:y). */
    screenCrop?: string;
  };
  logicalCpus: number;
  /** Whether the screen recorder's ffmpeg.exe got the 1 ms timer (lib/timer-resolution.ps1). */
  screenTimerResolution?: { ok: boolean; detail: string };
  obsFile?: string;
  obsFileStartWallMs?: number;
  /** Frames the WSL preview server received from each ffmpeg preview feed. */
  preview?: PreviewStats;
  crash?: CrashResult;
};

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

function arrivalPts(file: string): number[] {
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, "utf8").matchAll(/pts_time:([-\d.]+)/g)].map(
    (m) => Number(m[1])
  );
}

/** Lag from the Windows wall time stamped on each -progress block (see recorder's onProgress). */
function pipelineLag(runDir: string, name: string, t0Ms: number) {
  const rows = readJsonl(path.join(runDir, `progress-${name}.jsonl`)).map(
    (p) => ({ out: Number(p.out_time_us) / 1e6, winMs: Number(p.winMs) })
  );
  return lagFromRows(rows, t0Ms);
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

export type Report = ReturnType<typeof buildReport>;

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
        // Real screen in the selftest: only the marker square flashes.
        screen: {
          file: path.join(runDir, FILES.screen),
          crop: meta.synthetic?.screenCrop,
        },
        camera: { file: path.join(runDir, FILES.camera), crop: undefined },
        mic: path.join(runDir, FILES.mic),
        origin: meta.t0Ms,
      };

  const probes = {
    screen: probe(src.screen.file),
    camera: isBaseline ? null : probe(src.camera.file),
    mic: isBaseline ? null : probe(src.mic),
  };
  // A hard-killed MKV has no container duration until it is remuxed.
  const duration =
    Number(probes.screen?.format.duration) ||
    lastPacketTime(src.screen.file) ||
    0;
  const micStart = Number(
    (isBaseline ? probes.screen : probes.mic)?.streams.find(
      (s) => s.codec_type === "audio"
    )?.start_time ?? 0
  );

  // Per-frame arrival stamps before the CFR step (rig runs only).
  const pts = {
    screen: isBaseline
      ? []
      : arrivalPts(path.join(runDir, FILES.screenArrivals)),
    camera: isBaseline
      ? []
      : arrivalPts(path.join(runDir, FILES.cameraArrivals)),
  };
  const CAM_FPS = 30000 / 1001;

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
    // Undo the CFR step's per-frame shift, so offsets are capture-time.
    const screenCap =
      screen === null ? null : screen - cfrShift(pts.screen, 60, screen);
    const cameraCap =
      camera === null ? null : camera - cfrShift(pts.camera, CAM_FPS, camera);
    return {
      marker: m.label,
      expected: Math.round(m.expected * 1000) / 1000,
      screen,
      camera,
      audio,
      camMinusScreenMs: ms(cameraCap, screenCap),
      audioMinusScreenMs: ms(audio, screenCap),
      audioMinusCameraMs: ms(audio, cameraCap),
      fileTimeCamMinusScreenMs: ms(camera, screen),
    };
  });
  // Drift rules: judge.ts. Rig runs are judged with the CFR saw-tooth removed;
  // the OBS baseline can't be, so its camera pairs get one frame of room.
  const { sync, verdicts: syncVerdicts } = judgeSync(rows, {
    cfrRemoved: !isBaseline,
  });

  // Frames. Both files are CFR, so loss is judged on arrival timing before the
  // CFR step. The screen (ddagrab, or the synthetic screen) is paced by the
  // machine's clock, so it is also judged on rate.
  const frames = isBaseline
    ? null
    : {
        screen: {
          arrivals: arrivalsFromPts(pts.screen, 60, { rateLocked: true }),
          written: countPackets(src.screen.file),
          expected: Math.round(duration * 60),
        },
        camera: {
          arrivals: arrivalsFromPts(pts.camera, CAM_FPS, {
            rateLocked: false,
          }),
          written: countPackets(src.camera.file),
          expected: Math.round((duration * 30000) / 1001),
        },
        pipeline: {
          screen: pipelineLag(runDir, "screen", meta.t0Ms),
          camera: pipelineLag(runDir, "camera", meta.t0Ms),
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

  // Preview delay, measured by the page at the moment it decodes a preview frame:
  //  screen path: its own on-screen ms clock (drawn → captured → encoded → sent → decoded);
  //  camera path: a flash on wall time W (drawn → seen by the camera → … → decoded).
  // Neither includes the page's composite or the display's scan-out (~1–2 frames).
  const delayBy = (source: RegExp) =>
    stats(
      events
        .filter((e) => e.type === "latency" && source.test(String(e.source)))
        .flatMap((e) => e.samples as number[])
    );
  const previewDelayMs = {
    screenFeed: delayBy(/screen-feed|obs-virtual-camera$/),
    cameraFeed: delayBy(/camera-feed/),
    source: isBaseline ? "OBS Virtual Camera" : "rig preview feeds",
  };

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
  const verdicts: Record<string, string> = {
    ...syncVerdicts,
    ...(frames
      ? frameVerdicts({
          screen: frames.screen.arrivals,
          camera: frames.camera.arrivals,
          lag: frames.pipeline,
          logDropWarnings: logWarnings.filter((l) =>
            /real-time buffer|dropp/i.test(l)
          ).length,
        })
      : { "no dropped frames": "n/a (OBS: see its log)" }),
    "preview feeds deliver frames": isBaseline
      ? "n/a (baseline)"
      : previewVerdict(meta.preview),
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
    previewDelayMs,
    preview: meta.preview ?? null,
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
