// The rig's verdict rules, as pure functions over numbers: no ffmpeg, no files,
// no Windows. analyze.ts feeds them real runs; checks.ts feeds them the review's
// repro cases (stall-then-burst, steady drift, cancelling errors, lag growth) so
// a rule that can false-pass is caught without recording anything.

import { median, r1, stats } from "./stats.ts";

export * from "./stats.ts";
export * from "./judge-sync.ts";

/** A gap in capture this long is a visible freeze. */
export const STALL_MS = 100;
/** How far a rate-locked source (screen) may run from nominal: QPC against the system clock. */
export const RATE_PPM_TOLERANCE = 100;
export const LAG_GROWTH_LIMIT_SEC = 0.5;

// ---------- preflight (camera and mic, before the long runs) ----------

/**
 * Below this, the PC's beep reached the mic without crossing the room: the
 * delay is from the page scheduling the beep to the beep in the mic file, with
 * Chrome's own output latency and the tone window's half-width taken off. A
 * guess until a real run shows both cases.
 */
export const ACOUSTIC_MIN_MS = 5;

/** A recorder that quit before the planned stop: its name and its ffmpeg log's error lines. */
export type EarlyExit = { name: string; code: number | null; errors: string[] };

/** What the rig planned to record and what each recorder got (rig.ts writes it to meta.json). */
export type CaptureRun = {
  plannedSec: number;
  /** ffmpeg file time each recorder reached. */
  recordedSec: Record<string, number>;
  earlyExits: EarlyExit[];
  /** Why the rig stopped, when it wasn't the planned length or a recorder quitting. */
  stoppedBy?: string;
};

/** Seconds a run may fall short of the plan and still count as complete. */
export const CAPTURE_SLACK_SEC = 2;

/** What to change for the ffmpeg errors a device input fails with. */
export function ffmpegExitHint(errors: string[]): string {
  const all = errors.join("\n");
  if (/Could not set video options/i.test(all))
    return "the Cam Link isn't offering 3840x2160 at 29.97 fps NV12: is the camera on, its HDMI out at 2160p 29.97 (UHD 30p), and nothing else using the Cam Link (OBS, the Camera app, a browser tab)?";
  if (/Could not set audio options/i.test(all))
    return "the mic isn't offering 48 kHz stereo: check Voicemeeter's sample rate is 48000";
  if (/Could not run graph|in use|busy/i.test(all))
    return "the device is busy: close OBS and anything else using the Cam Link or the mic";
  if (/Could not find|No such|not found/i.test(all))
    return "the device is gone: is it plugged in?";
  return "see the ffmpeg log in the run folder";
}

/**
 * null if every recorder ran the planned length; else why not, in words. A
 * short capture can't judge anything else, so the preflight says so instead of
 * "0 of ~0 flashes".
 */
export function captureShortfall(c: CaptureRun): string | null {
  const got = Object.values(c.recordedSec);
  const least = got.length ? Math.min(...got) : 0;
  if (least >= c.plannedSec - CAPTURE_SLACK_SEC && !c.earlyExits.length)
    return null;
  const each = Object.entries(c.recordedSec)
    .map(([k, v]) => `${k} ${Math.round(v)} s`)
    .join(", ");
  const why = c.earlyExits.length
    ? c.earlyExits
        .map((e) => {
          const last = e.errors.find((l) => /\[fatal\]/.test(l)) ?? e.errors[0];
          const first = e.errors.find((l) => !/Error opening input/i.test(l));
          const quote = (first ?? last ?? "").replace(
            /^\[[^\]]*\]\s*(\[[^\]]*\]\s*)?/,
            ""
          );
          return `The ${e.name} recorder (ffmpeg) quit${e.code !== null ? ` with code ${e.code}` : ""}${quote ? `: "${quote}"` : ""}; ${ffmpegExitHint(e.errors)}`;
        })
        .join("; ")
    : (c.stoppedBy ?? "a recorder stopped delivering (see ffmpeg-*.log)");
  return `recorded ${Math.round(least)} s of the planned ${c.plannedSec} s (${each}). ${why}`;
}

export type PreflightInput = {
  /** The planned and actual capture; absent for runs from before it was recorded. */
  capture?: CaptureRun;
  seconds: number;
  pageStarted: boolean;
  sound: string;
  phone: { cameraOnGrid: number; micOnsets: number; pairs: number };
  pcBeeps: { played: number; delaysMs: number[] };
};

/** Every check must PASS before the long runs: each FAIL says what to change. */
export function judgePreflight(p: PreflightInput): Record<string, string> {
  const expectPhone = Math.floor(p.seconds / 10);
  const v: Record<string, string> = {};
  if (p.capture) {
    const short = captureShortfall(p.capture);
    const row = `capture runs the planned ${p.capture.plannedSec} s`;
    if (short) {
      v[row] = `FAIL (${short})`;
      const notJudged = `FAIL (not checked: the capture stopped early, see "${row}")`;
      for (const k of [
        "camera sees the phone's flash",
        "mic hears the phone's 2 kHz beep",
        "phone flash and beep pair up",
        "mic hears the PC's 1 kHz beep",
        "PC beep reaches the mic through the air",
      ])
        v[k] = notJudged;
      return v;
    }
    v[row] = "PASS";
  }
  v["camera sees the phone's flash"] =
    p.phone.cameraOnGrid >= 2
      ? `PASS (${p.phone.cameraOnGrid} of ~${expectPhone} flashes)`
      : `FAIL (${p.phone.cameraOnGrid} of ~${expectPhone} flashes in ${p.seconds} s. Is the video playing? Prop the phone close in front of the Cam Link, in the middle of the picture, its screen filling at least a quarter of it; full brightness, Adaptive brightness off)`;
  v["mic hears the phone's 2 kHz beep"] =
    p.phone.micOnsets >= 2
      ? `PASS (${p.phone.micOnsets} of ~${expectPhone} beeps)`
      : `FAIL (${p.phone.micOnsets} of ~${expectPhone} beeps in ${p.seconds} s. Phone volume about 2/3, not muted, not on Bluetooth; is the video playing?)`;
  v["phone flash and beep pair up"] =
    p.phone.pairs >= 2
      ? `PASS (${p.phone.pairs} pairs)`
      : `FAIL (${p.phone.pairs} flashes with their beep within 0.5 s; both must work, from the same phone)`;
  const heard = p.pcBeeps.delaysMs.length;
  v["mic hears the PC's 1 kHz beep"] = !p.pageStarted
    ? "FAIL (the page never started, so nothing beeped)"
    : p.sound !== "running"
      ? `FAIL (the page's sound is ${p.sound}: the beep can't play)`
      : p.pcBeeps.played >= 2 && heard * 2 >= p.pcBeeps.played
        ? `PASS (${heard} of ${p.pcBeeps.played} beeps)`
        : `FAIL (${heard} of ${p.pcBeeps.played} beeps. Speakers on, not headphones, Windows volume about 50%)`;
  const d = heard ? median(p.pcBeeps.delaysMs) : null;
  v["PC beep reaches the mic through the air"] =
    d === null
      ? "FAIL (no PC beep heard, so its delay can't be measured)"
      : d >= ACOUSTIC_MIN_MS
        ? `PASS (${r1(d)} ms after Chrome played it)`
        : `FAIL (${r1(d)} ms after Chrome played it, i.e. no acoustic delay: Voicemeeter is routing the PC's sound digitally into B1, the bus the rig records as the mic. Then A/V drift measures Voicemeeter's internal copy, not the mic. In Voicemeeter, turn off B1 on the virtual input strip Windows plays into (VAIO), keep A1 on so the speakers play it, and run again)`;
  return v;
}

// ---------- frames ----------

/**
 * Capture timing before the CFR step, from each frame's arrival stamp (Windows
 * wall time, file seconds).
 *  - lostFrames: persistent steps in the timing residual. A lost frame shifts
 *    every later frame by one interval for good; jitter and backlogs that clear
 *    within ~5 s do not.
 *  - missingFrames (rate-locked sources only, i.e. the screen): frames short of
 *    span × nominal fps. ddagrab and the synthetic screen are paced by the
 *    machine's own clock, so any shortfall beyond ±100 ppm is loss.
 *  - stalls: gaps over 100 ms after start-up. A stall followed by a burst loses
 *    no frames by count, but the CFR step turns it into a freeze plus dropped
 *    frames, so it is judged on its own.
 *  - judder: what the CFR step does with this timing (estimated): output slots
 *    left empty (repeated frame) and input frames sharing a slot (dropped).
 */
export function arrivalsFromPts(
  pts: number[],
  nominalFps: number,
  opts: { rateLocked: boolean }
) {
  const n = pts.length;
  if (n < 100) return null;
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push((pts[i]! - pts[i - 1]!) * 1000);
  // Steady part: skip the first 3 s of start-up.
  const s0 = Math.min(n - 2, Math.round(3 * nominalFps));
  const T = (pts[n - 1]! - pts[s0]!) / (n - 1 - s0);
  const r = pts.map((p, i) => p - pts[s0]! - (i - s0) * T);
  const rollingMedian = (lo: number, hi: number) =>
    median(r.slice(Math.max(0, lo), Math.min(n, hi)));
  const W = 15;
  const P = Math.round(5 * nominalFps);
  let lost = 0;
  let events = 0;
  for (let i = s0 + W; i < n - W; i++) {
    const step =
      rollingMedian(i, i + 2 * W + 1) - rollingMedian(i - 2 * W, i + 1);
    if (step <= 0.6 * T) continue;
    // Persistence: still stepped 5 s either side, so not a backlog that cleared.
    const lasting =
      rollingMedian(i + W, i + W + P) - rollingMedian(i - W - P, i - W);
    if (lasting > 0.6 * T) {
      lost += Math.round(lasting / T);
      events++;
    }
    i += 2 * W;
  }
  const nominalT = 1 / nominalFps;
  const spanFrames = (pts[n - 1]! - pts[s0]!) / nominalT + 1;
  const missingFrames = opts.rateLocked
    ? Math.round(spanFrames - (n - s0))
    : null;
  const missingTolerance = opts.rateLocked
    ? Math.max(2, Math.ceil((spanFrames * RATE_PPM_TOLERANCE) / 1e6))
    : null;
  const steady = intervals.slice(s0);
  const stallList = steady
    .map((ms, k) => ({ frame: s0 + k + 1, atSec: pts[s0 + k + 1]!, ms }))
    .filter((x) => x.ms > STALL_MS);
  // CFR estimate: fps=N rounds each input to the nearest output slot.
  const slots = new Map<number, number>();
  for (let i = s0; i < n; i++) {
    const k = Math.round(pts[i]! / nominalT);
    slots.set(k, (slots.get(k) ?? 0) + 1);
  }
  const ks = [...slots.keys()];
  const kMin = Math.min(...ks);
  const kMax = Math.max(...ks);
  let dropped = 0;
  for (const c of slots.values()) dropped += c - 1;
  const repeated = kMax - kMin + 1 - slots.size;
  // Each output slot left empty next to one holding two inputs is a visible
  // judder: a frame shown twice, its neighbour never shown.
  const judderPairs = Math.min(repeated, dropped);
  const outSlots = kMax - kMin + 1;
  const spanMin = (pts[n - 1]! - pts[s0]!) / 60;
  return {
    frames: n,
    firstArrival: pts[0]!,
    lastArrival: pts[n - 1]!,
    measuredFps: Math.round((1 / T) * 1000) / 1000,
    clockPpm: Math.round((1 / T / nominalFps - 1) * 1e6),
    lostFrames: lost,
    lossEvents: events,
    missingFrames,
    missingTolerance,
    stalls: {
      count: stallList.length,
      maxMs: stallList.length ? r1(Math.max(...stallList.map((s) => s.ms))) : 0,
      first: stallList.slice(0, 5).map((s) => ({
        frame: s.frame,
        atSec: Math.round(s.atSec * 1000) / 1000,
        ms: r1(s.ms),
      })),
    },
    judder: {
      intervalsOver1_5x: steady.filter((ms) => ms > 1.5 * nominalT * 1000)
        .length,
      cfrRepeatedEst: repeated,
      cfrDroppedEst: dropped,
      /** Repeat + drop pairs as a share of output frames (%): the judder metric. */
      pct: Math.round((judderPairs / outSlots) * 10000) / 100,
      perMin: spanMin > 0 ? r1(judderPairs / spanMin) : 0,
    },
    intervalMs: stats(intervals.slice(s0)),
  };
}

export type Arrivals = NonNullable<ReturnType<typeof arrivalsFromPts>>;

/**
 * Screen judder, reported and not judged. The screen's frames are stamped when
 * ffmpeg reads them, not when ddagrab captured them, and the CFR step puts two
 * that land in one 60 fps slot into it (one dropped) and leaves the next slot
 * empty (one repeated): a visible stutter on anything moving. There's no
 * threshold to hold it to yet: the OBS baseline has no arrival stamps, so its
 * figure can't be measured the same way.
 */
export function judderNote(a: Arrivals | null): string {
  if (!a) return "n/a (no arrival data)";
  return `${a.judder.pct}% of output frames (${a.judder.perMin}/min) repeated with a neighbour dropped; not judged: no OBS figure to hold it to`;
}

/**
 * How far a recorder fell behind real time: the Windows wall time when ffmpeg
 * reported muxed output time `out`, minus T0 + out. Growth is measured against
 * the lag 5–15 s in, with a 5-sample rolling median against delivery jitter.
 * (ffmpeg's `speed` has 3 significant figures, so lag derived from it is
 * ±1.8 s at 30 min; the Windows stamp is good to a few ms.)
 */
export function lagFromRows(
  rows: { out: number; winMs: number }[],
  t0Ms: number
) {
  const pts = rows
    .filter((p) => p.out > 0 && Number.isFinite(p.winMs))
    .map((p) => ({ out: p.out, lag: (p.winMs - t0Ms) / 1000 - p.out }));
  if (pts.length < 20) return null;
  const baseRows = pts.filter((p) => p.out >= 5 && p.out <= 15);
  const base = median(
    (baseRows.length >= 3 ? baseRows : pts.slice(0, 10)).map((p) => p.lag)
  );
  const rolled = pts.map((_, i) =>
    median(pts.slice(Math.max(0, i - 2), i + 3).map((p) => p.lag))
  );
  const growth = rolled.map((l) => l - base);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    baseLagSec: r2(base),
    maxLagGrowthSec: r2(Math.max(...growth)),
    endLagGrowthSec: r2(growth[growth.length - 1]!),
  };
}

export type FrameInputs = {
  screen: Arrivals | null;
  camera: Arrivals | null;
  lag: Record<string, ReturnType<typeof lagFromRows>>;
  logDropWarnings: number;
};

export function frameVerdicts(f: FrameInputs) {
  const lost: string[] = [];
  for (const [name, a] of [
    ["screen", f.screen],
    ["camera", f.camera],
  ] as const) {
    if (!a) {
      lost.push(`${name}: no arrival data`);
      continue;
    }
    if (a.lostFrames) lost.push(`${name} ${a.lostFrames} lost`);
    if (a.missingFrames !== null && a.missingFrames > a.missingTolerance!)
      lost.push(`${name} ${a.missingFrames} short at ${a.measuredFps} fps`);
  }
  if (f.logDropWarnings) lost.push(`${f.logDropWarnings} drop warnings in log`);
  const stalls = [f.screen, f.camera]
    .map((a, i) =>
      a && a.stalls.count
        ? `${i ? "camera" : "screen"} ${a.stalls.count} (max ${a.stalls.maxMs} ms)`
        : ""
    )
    .filter(Boolean);
  const lagEntries = Object.entries(f.lag);
  const lagMissing = lagEntries.filter(([, l]) => !l).map(([k]) => k);
  const lagBad = lagEntries
    .filter(([, l]) => l && l.maxLagGrowthSec > LAG_GROWTH_LIMIT_SEC)
    .map(([k, l]) => `${k} +${l!.maxLagGrowthSec} s`);
  return {
    "no dropped frames": lost.length ? `FAIL (${lost.join("; ")})` : "PASS",
    [`no capture stalls > ${STALL_MS} ms`]:
      !f.screen || !f.camera
        ? "n/a (no arrival data)"
        : stalls.length
          ? `FAIL (${stalls.join("; ")})`
          : "PASS",
    "recorder keeps up (lag growth <= 0.5 s)": lagBad.length
      ? `FAIL (${lagBad.join("; ")})`
      : lagMissing.length
        ? `n/a (no Windows-clock progress for ${lagMissing.join(", ")})`
        : "PASS",
  };
}

// ---------- preview ----------

export type PreviewStats = Record<
  string,
  { frames: number; firstFrameSec: number | null; maxGapSec: number }
>;

/** Each live feed must deliver its first frame within 10 s and never go quiet for 2 s. */
export function previewVerdict(p: PreviewStats | undefined) {
  if (!p) return "n/a (run predates preview stats)";
  const bad = Object.entries(p)
    .map(([feed, s]) =>
      !s.frames
        ? `${feed}: 0 frames`
        : s.firstFrameSec! > 10
          ? `${feed}: first frame at ${s.firstFrameSec} s`
          : s.maxGapSec > 2
            ? `${feed}: ${s.maxGapSec} s gap`
            : ""
    )
    .filter(Boolean);
  return bad.length ? `FAIL (${bad.join("; ")})` : "PASS";
}

/** A verdict string counts as a pass only if it says PASS. */
export const passed = (v: string | undefined) => !!v && v.startsWith("PASS");
