// Turns a run folder into report.md / report.json, judged against the stop criteria:
//   A/V, camera/screen and lip-sync drift <= 33 ms, no dropped frames or stalls,
//   the recorder keeping up, live preview feeds, CPU/GPU <= ~1.5x the OBS
//   baseline, <= ~25 GB/h. The rules themselves live in judge.ts.
// Drift is measured at sync markers: the onset is found in every stream, and
// the offsets between streams must not move. Real runs use two marker sources
// (lib/sync.ts): the PC's DELL flash + 1 kHz beep for A/V, and a phone in front
// of the camera (white flash + 2 kHz beep every 10 s) for lip sync; camera/
// screen is derived from the two. Synthetic runs flash every source at once.
import fs from "node:fs";
import path from "node:path";
import { perf } from "./perf.ts";
import { toMarkdown } from "./report-md.ts";
import { countPackets, ffmpeg, lastPacketTime, probe } from "./ff.ts";
import type { CrashResult } from "./recovery.ts";
import { FILES } from "./recorder.ts";
import {
  arrivalsFromPts,
  cfrShift,
  frameVerdicts,
  judgeSync,
  lipSyncVsObs,
  judgePreflight,
  lagFromRows,
  previewVerdict,
  stats,
  type MarkerRow,
  type PreviewStats,
} from "./judge.ts";
import {
  analyzePhoneMarkers,
  onsetNear,
  PC_BEEP_HZ,
  pcBeepDelayMs,
  PHONE_BEEP_HZ,
  TONE,
  toneSeries,
} from "./sync.ts";

export type Meta = {
  mode: "selftest" | "record" | "crash" | "baseline" | "preflight";
  /**
   * What the camera watches for its sync marker. "phone": a phone playing the
   * rig's flash + 2 kHz video (lib/phone.ts). Absent: the PC's own flash (the
   * synthetic sources, and runs from before the phone).
   */
  cameraMarker?: "phone";
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

/** The whole mic, mono at TONE.sr, as samples in [-1, 1). Sample i is at file time startTime + i / sr. */
function micSamples(file: string): Float64Array {
  const { stdout } = ffmpeg(
    [
      "-i",
      path.basename(file),
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(TONE.sr),
      "-f",
      "s16le",
      "-",
    ],
    path.dirname(file)
  );
  const n = stdout.length >> 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = stdout.readInt16LE(i * 2) / 32768;
  return x;
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

type Marker = {
  label: string;
  expected: number;
  wallMs: number;
  /** File time the page scheduled its beep for (the flash goes up on the nearest frame). */
  beepAt?: number;
};

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
          beepAt:
            typeof e.beepWallMs === "number"
              ? ((e.beepWallMs as number) - origin) / 1000
              : undefined,
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
  const marks = markers(meta, events, src.origin, duration);
  const phoneMode = meta.cameraMarker === "phone";
  const micX = micSamples(src.mic);
  const mic1k = toneSeries(micX, PC_BEEP_HZ, micStart);
  const mic2k = phoneMode
    ? toneSeries(micX, PHONE_BEEP_HZ, micStart)
    : undefined;
  const ms = (a: number | null, b: number | null) =>
    a === null || b === null ? null : Math.round((a - b) * 10000) / 10;
  // Undo the CFR step's per-frame shift, so offsets are capture-time.
  const camCfr = (t: number) => cfrShift(pts.camera, CAM_FPS, t);
  const screenAt = (m: Marker) => {
    const screen = onsetNear(
      lumaSeries(src.screen.file, m.expected - 2, 4, src.screen.crop),
      m.expected,
      25
    );
    return {
      screen,
      screenCap:
        screen === null ? null : screen - cfrShift(pts.screen, 60, screen),
    };
  };
  let rows: MarkerRow[];
  let markerRows: Record<string, string | number | null>[];
  let phoneMarkers: Record<string, string | number | null>[] = [];
  let phone: ReturnType<typeof analyzePhoneMarkers>["summary"] | null = null;
  if (phoneMode) {
    // PC markers: screen and mic 1 kHz only (the camera watches the phone).
    // Phone markers: the whole run, no PC time to search around.
    const r = analyzePhoneMarkers({
      marks,
      screenAround: (t) =>
        lumaSeries(src.screen.file, t - 2, 4, src.screen.crop),
      screenCfr: (t) => cfrShift(pts.screen, 60, t),
      camera: lumaSeries(src.camera.file, 0, duration + 1, src.camera.crop),
      cameraCfr: camCfr,
      mic1k,
      mic2k: mic2k!,
      // The preflight flashes the DELL every 5 s: it only asks "seen and heard?".
      excludeNearPc: meta.mode !== "preflight",
    });
    phone = r.summary;
    rows = r.rows;
    markerRows = r.pcRows;
    phoneMarkers = r.phoneRows;
  } else {
    markerRows = marks.map((m) => {
      const { screen, screenCap } = screenAt(m);
      const camera = onsetNear(
        lumaSeries(src.camera.file, m.expected - 2, 4, src.camera.crop),
        m.expected,
        8
      );
      const audio = onsetNear(mic1k, m.expected, 0.002);
      const cameraCap = camera === null ? null : camera - camCfr(camera);
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
    rows = markerRows as unknown as MarkerRow[];
  }
  // Drift rules: judge.ts. Rig runs are judged with the CFR saw-tooth removed;
  // the OBS baseline can't be, so its camera pairs get one frame of room.
  const { sync, verdicts: syncVerdicts } = judgeSync(rows, {
    cfrRemoved: !isBaseline,
  });
  const pageStart = events.find((e) => e.type === "page-start");
  // Unattended, nobody is watching the page: a run whose markers never landed
  // (page didn't start, camera doesn't see the phone, mic doesn't hear a
  // beep) must fail, not read n/a.
  const unattended =
    !meta.synthetic && (meta.mode === "record" || meta.mode === "baseline");
  if (unattended) {
    const why: Record<string, string> = {
      "A/V drift <= 33 ms": "does the mic hear the PC's 1 kHz beep?",
      "camera/screen drift <= 33 ms":
        "needs both: the PC's beep in the mic and the phone's flash + 2 kHz beep",
      "lip sync (audio/camera) drift <= 33 ms":
        "does the camera see the phone's flash, and the mic hear its 2 kHz beep?",
    };
    for (const [k, v] of Object.entries(syncVerdicts)) {
      if (v.startsWith("n/a"))
        (syncVerdicts as Record<string, string>)[k] =
          `FAIL (${v.slice(5, -1)}: ${why[k] ?? "do the markers land?"})`;
    }
  }

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
  // The baseline's own audio - camera median, for lip sync vs OBS (no clap needed).
  const baselineReport =
    baselineDir && fs.existsSync(path.join(baselineDir, "report.json"))
      ? (JSON.parse(
          fs.readFileSync(path.join(baselineDir, "report.json"), "utf8")
        ) as {
          markerSource?: string;
          sync?: { audioMinusCamera?: { medianMs: number | null } };
        })
      : null;
  const markerSource = phoneMode ? "phone" : "pc-flash";
  // Both runs must time the camera on the same marker, or the medians share nothing.
  const lipSync =
    baselineReport &&
    (baselineReport.markerSource ?? "pc-flash") !== markerSource
      ? {
          deltaMs: null,
          verdict: `n/a (the baseline's camera watched the ${baselineReport.markerSource ?? "pc-flash"} marker, this run's the ${markerSource}: run the baseline again)`,
        }
      : lipSyncVsObs(
          sync.audioMinusCamera.medianMs,
          baselineReport?.sync?.audioMinusCamera?.medianMs
        );
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
        lipSyncVsObsMs: lipSync.deltaMs,
      }
    : null;

  // The PC beep's delay into the mic, from the moment the page scheduled it to
  // the moment it is in the mic file. Chrome's own output latency (reported by
  // the page) and the tone window's half-width are taken off.
  const outputLatencySec =
    typeof pageStart?.outputLatencyMs === "number" &&
    pageStart.outputLatencyMs > 0 &&
    pageStart.outputLatencyMs < 500
      ? pageStart.outputLatencyMs / 1000
      : 0;
  const pcBeepDelaysMs = marks
    .filter((m) => m.beepAt !== undefined)
    .map((m) => pcBeepDelayMs(mic1k, mic2k, m.beepAt!, outputLatencySec));

  // Verdicts
  const verdicts: Record<string, string> =
    meta.mode === "preflight"
      ? judgePreflight({
          seconds: Math.round(duration),
          pageStarted: !!pageStart,
          sound: pageStart ? String(pageStart.audio ?? "running") : "none",
          phone: {
            cameraOnGrid: phone
              ? phone.pairs + phone.unpaired + phone.droppedNearPcMarker
              : 0,
            micOnsets: phone?.micOnsets ?? 0,
            pairs: phone?.pairs ?? 0,
          },
          pcBeeps: {
            played: pcBeepDelaysMs.length,
            delaysMs: pcBeepDelaysMs.filter((d): d is number => d !== null),
          },
        })
      : {
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
  if (meta.mode === "record")
    verdicts[
      "lip sync vs OBS (audio - camera median within 33 ms + 1 OBS frame of the baseline's)"
    ] = lipSync.verdict;
  if (unattended)
    verdicts["page started unattended, sound on"] = !pageStart
      ? "FAIL (the page never started: no page-start event)"
      : pageStart.audio && pageStart.audio !== "running"
        ? `FAIL (sound ${String(pageStart.audio)}: the beep can't play)`
        : "PASS";
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
    markerSource,
    sync,
    markers: markerRows,
    phoneMarkers,
    phone,
    pcBeepDelaysMs,
    chromeOutputLatencyMs: Math.round(outputLatencySec * 1000),
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
