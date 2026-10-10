// The rig's verdict rules, as pure functions over numbers: no ffmpeg, no files,
// no Windows. analyze.ts feeds them real runs; checks.ts feeds them the review's
// repro cases (stall-then-burst, steady drift, cancelling errors, lag growth) so
// a rule that can false-pass is caught without recording anything.

export const LIMIT_MS = 33;
/** One camera frame at 29.97 fps: how far the CFR saw-tooth may move the camera's offset. */
export const CAMERA_FRAME_MS = 1000 / (30000 / 1001);
/** A gap in capture this long is a visible freeze. */
export const STALL_MS = 100;
/** How far a rate-locked source (screen) may run from nominal: QPC against the system clock. */
export const RATE_PPM_TOLERANCE = 100;
export const LAG_GROWTH_LIMIT_SEC = 0.5;

export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

export function stats(a: number[]) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    avg: s.reduce((x, y) => x + y, 0) / s.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: s[s.length - 1]!,
    n: s.length,
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------- sync ----------

export type SyncPair = {
  n: number;
  medianMs: number | null;
  maxDevMs: number | null;
  rangeMs: number | null;
  /** Fitted offset change from the first marker to the last: the drift. */
  trendMs: number | null;
};

/** Offsets (ms) at each marker time (s) → median, spread and linear trend. */
export function driftStats(pts: { t: number; v: number }[]): SyncPair {
  if (pts.length < 2)
    return {
      n: pts.length,
      medianMs: pts[0]?.v ?? null,
      maxDevMs: null,
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
  return {
    n: pts.length,
    medianMs: r1(med),
    maxDevMs: r1(Math.max(...vals.map((v) => Math.abs(v - med)))),
    rangeMs: r1(Math.max(...vals) - Math.min(...vals)),
    trendMs: r1(slope * (pts[pts.length - 1]!.t - pts[0]!.t)),
  };
}

/**
 * Drift is judged two ways, both against 33 ms:
 *  - steady drift: |linear trend over the run| (the plan's "offset at t=0, 15
 *    and 30 min"). A deviation-from-median rule alone lets 0→66 ms pass.
 *  - jumps: every marker within 33 ms of the median.
 * `sawtoothMs` is extra room for a CFR saw-tooth that could not be removed
 * (OBS files in the baseline): the CFR step drops or repeats a whole frame
 * when a device clock runs fast or slow, so the offset ramps through up to one
 * frame and snaps back, which looks like trend over a short run. Rig files
 * have it removed per marker (cfrShift), so they get no extra room.
 */
export function syncVerdict(d: SyncPair, sawtoothMs = 0): string {
  if (d.n < 3) return `n/a (${d.n} markers found, need 3)`;
  const limit = LIMIT_MS + sawtoothMs;
  const why: string[] = [];
  if (Math.abs(d.trendMs!) > limit) why.push(`trend ${d.trendMs} ms`);
  if (d.maxDevMs! > limit) why.push(`jump ${d.maxDevMs} ms`);
  return why.length ? `FAIL (${why.join(", ")})` : "PASS";
}

/**
 * How far the CFR step moved the frame captured nearest file time t: fps=N
 * puts a frame that arrived at a into slot round(a·N)/N. Subtracting it turns a
 * file-time onset back into a capture-time onset, which removes the camera's
 * saw-tooth (bounded by ±½ frame) and leaves only real drift. `pts` sorted.
 */
export function cfrShift(pts: number[], fps: number, t: number): number {
  if (!pts.length) return 0;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]! < t) lo = mid;
    else hi = mid;
  }
  const a =
    Math.abs(pts[lo]! - t) <= Math.abs(pts[hi]! - t) ? pts[lo]! : pts[hi]!;
  return Math.round(a * fps) / fps - a;
}

export type MarkerRow = {
  expected: number;
  camMinusScreenMs: number | null;
  audioMinusScreenMs: number | null;
  audioMinusCameraMs: number | null;
};

export function judgeSync(rows: MarkerRow[], opts = { cfrRemoved: true }) {
  const pair = (
    key: "camMinusScreenMs" | "audioMinusScreenMs" | "audioMinusCameraMs"
  ) =>
    driftStats(
      rows
        .filter((r) => r[key] !== null)
        .map((r) => ({ t: r.expected, v: r[key] as number }))
    );
  const sync = {
    camMinusScreen: pair("camMinusScreenMs"),
    audioMinusScreen: pair("audioMinusScreenMs"),
    audioMinusCamera: pair("audioMinusCameraMs"),
  };
  const camRoom = opts.cfrRemoved ? 0 : CAMERA_FRAME_MS;
  return {
    sync,
    verdicts: {
      "A/V drift <= 33 ms": syncVerdict(sync.audioMinusScreen),
      "camera/screen drift <= 33 ms": syncVerdict(sync.camMinusScreen, camRoom),
      "lip sync (audio/camera) drift <= 33 ms": syncVerdict(
        sync.audioMinusCamera,
        camRoom
      ),
    },
  };
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
      cfrRepeatedEst: kMax - kMin + 1 - slots.size,
      cfrDroppedEst: dropped,
    },
    intervalMs: stats(intervals.slice(s0)),
  };
}

export type Arrivals = NonNullable<ReturnType<typeof arrivalsFromPts>>;

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
