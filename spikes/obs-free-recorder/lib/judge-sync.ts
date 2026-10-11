// The drift rules (A/V, camera/screen, lip sync), lip sync against OBS and
// CPU/GPU against OBS, as pure functions over numbers. Split out of judge.ts
// for size; judge.ts re-exports all of it.
import { CAMERA_FRAME_MS, LIMIT_MS, median, r1 } from "./stats.ts";

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
export function syncVerdict(
  d: SyncPair,
  sawtoothMs = 0,
  jumpsFrom?: { pair: SyncPair; label: string }
): string {
  if (d.n < 3) return `n/a (${d.n} markers found, need 3)`;
  const limit = LIMIT_MS + sawtoothMs;
  const why: string[] = [];
  if (Math.abs(d.trendMs!) > limit) why.push(`trend ${d.trendMs} ms`);
  const jump = jumpsFrom ? jumpsFrom.pair.maxDevMs : d.maxDevMs;
  if (jumpsFrom && jumpsFrom.pair.n < 3)
    why.push(`only ${jumpsFrom.pair.n} ${jumpsFrom.label}s, need 3`);
  else if (jump! > limit)
    why.push(`jump ${jump} ms${jumpsFrom ? ` in ${jumpsFrom.label}s` : ""}`);
  return why.length ? `FAIL (${why.join(", ")})` : "PASS";
}

/**
 * The phone's flash wanders ±25 ms against its own beep from one flash to the
 * next (its display and video decoder, not the rig), so a single phone marker
 * can sit 30–40 ms off the median with nothing wrong. Lip-sync jumps are
 * judged on the median of the markers within ±30 s of each one (~6 flashes)
 * instead: per-flash jitter is independent, so it about halves (the 2026-10-11 baseline: 36.9 → 19.1 ms), while a real
 * jump lasting ~35 s or more still moves some window's median by its full size.
 * The trend is a regression over every marker, which averages jitter already.
 * Same idea as lip sync vs OBS, which compares whole-run medians.
 */
export const PHONE_WINDOW_SEC = 60;
/** A window with fewer phone markers than this is left out (the PC marker's ±1.5 s exclusion, missed flashes). */
export const PHONE_WINDOW_MIN = 3;

/** Rolling median: at each point, the median of the points within ±windowSec/2 of it. */
export function windowMedians(
  pts: { t: number; v: number }[],
  windowSec: number,
  minPerWindow = PHONE_WINDOW_MIN
): { t: number; v: number }[] {
  return pts.flatMap((p) => {
    const near = pts.filter((q) => Math.abs(q.t - p.t) <= windowSec / 2);
    return near.length >= minPerWindow
      ? [{ t: p.t, v: median(near.map((q) => q.v)) }]
      : [];
  });
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

export function judgeSync(
  rows: MarkerRow[],
  opts: {
    cfrRemoved: boolean;
    /** Phone markers: judge lip-sync jumps on window medians (PHONE_WINDOW_SEC). */
    lipSyncWindowSec?: number;
  } = { cfrRemoved: true }
) {
  const points = (
    key: "camMinusScreenMs" | "audioMinusScreenMs" | "audioMinusCameraMs"
  ) =>
    rows
      .filter((r) => r[key] !== null)
      .map((r) => ({ t: r.expected, v: r[key] as number }));
  const pair = (
    key: "camMinusScreenMs" | "audioMinusScreenMs" | "audioMinusCameraMs"
  ) => driftStats(points(key));
  const win = opts.lipSyncWindowSec;
  const lipWindowed = win
    ? driftStats(windowMedians(points("audioMinusCameraMs"), win))
    : null;
  const sync = {
    camMinusScreen: pair("camMinusScreenMs"),
    audioMinusScreen: pair("audioMinusScreenMs"),
    audioMinusCamera: pair("audioMinusCameraMs"),
    /** Lip sync's window medians, which its jump rule reads (phone markers only). */
    audioMinusCameraWindowed: lipWindowed,
  };
  const camRoom = opts.cfrRemoved ? 0 : CAMERA_FRAME_MS;
  return {
    sync,
    verdicts: {
      "A/V drift <= 33 ms": syncVerdict(sync.audioMinusScreen),
      "camera/screen drift <= 33 ms": syncVerdict(sync.camMinusScreen, camRoom),
      "lip sync (audio/camera) drift <= 33 ms": syncVerdict(
        sync.audioMinusCamera,
        camRoom,
        lipWindowed
          ? { pair: lipWindowed, label: `±${win! / 2} s median` }
          : undefined
      ),
    },
  };
}

/**
 * Absolute lip sync against today's OBS, without a clap. In both runs the
 * camera sees the same phone's flash and the mic hears the same phone's 2 kHz
 * beep, so the phone's own A/V offset (its display against its speaker) is
 * identical and cancels: the difference of the two runs' median audio - camera
 * offsets is the rig's lip-sync error relative to OBS. (One run's median alone
 * is not lip sync: it includes the phone's offset.)
 * The OBS file shows the camera only at its 60 fps canvas ticks and has no
 * arrival stamps, so its camera onset lands up to one canvas frame late: the
 * limit gets that frame of room (`./rig lipsync-proof` measured 15–18 ms).
 */
export const OBS_CANVAS_FRAME_MS = 1000 / 60;

/**
 * `obsAudioOffsetMs`: the sync offset OBS adds to the mic source on purpose
 * (Advanced Audio Properties, saved in the scene collection; lib/obs-sync.ts).
 * It delays the mic in OBS's file, so OBS's audio - camera median carries it
 * and the rig's doesn't: it is taken off OBS's median before comparing, and
 * named in the verdict. `null`: unknown (a baseline from before it was saved),
 * so 0 is assumed and the verdict says so.
 */
export function lipSyncVsObs(
  rigMedianMs: number | null | undefined,
  obsMedianMs: number | null | undefined,
  obsAudioOffsetMs: number | null = 0
): { deltaMs: number | null; rawDeltaMs: number | null; verdict: string } {
  if (rigMedianMs == null || obsMedianMs == null)
    return {
      deltaMs: null,
      rawDeltaMs: null,
      verdict: `n/a (${obsMedianMs == null ? "no baseline audio - camera median" : "no audio - camera median in this run"})`,
    };
  const rawDeltaMs = r1(rigMedianMs - obsMedianMs);
  const deltaMs = r1(rawDeltaMs + (obsAudioOffsetMs ?? 0));
  const why =
    obsAudioOffsetMs === null
      ? `${deltaMs} ms vs OBS; OBS's mic sync offset unknown, 0 assumed`
      : obsAudioOffsetMs
        ? `${deltaMs} ms vs OBS after its ${obsAudioOffsetMs} ms mic sync offset; ${rawDeltaMs} ms raw`
        : `${deltaMs} ms vs OBS`;
  return {
    deltaMs,
    rawDeltaMs,
    verdict:
      Math.abs(deltaMs) <= LIMIT_MS + OBS_CANVAS_FRAME_MS
        ? `PASS (${why})`
        : `FAIL (${why})`,
  };
}

/**
 * CPU/GPU against the OBS baseline. A ratio that couldn't be computed is
 * "not measured", with the reason, and fails: it never counts as 0x.
 */
export function resourceVerdict(
  c: { cpuTotal: number | null; gpu: number | null } | null,
  missing: { cpu?: string; gpu?: string } = {}
): string {
  if (!c) return "n/a (no baseline run to compare with)";
  const fmt = (x: number) => `${x}x`;
  const unmeasured = [
    c.cpuTotal === null
      ? `total CPU not measured (${missing.cpu ?? "no ratio"})`
      : "",
    c.gpu === null ? `GPU not measured (${missing.gpu ?? "no ratio"})` : "",
  ].filter(Boolean);
  const got = [
    c.cpuTotal !== null ? `CPU ${fmt(c.cpuTotal)}` : "",
    c.gpu !== null ? `GPU ${fmt(c.gpu)}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (unmeasured.length)
    return `FAIL (${unmeasured.join("; ")}${got ? `; ${got}` : ""})`;
  return Math.max(c.cpuTotal!, c.gpu!) <= 1.5
    ? `PASS (${got})`
    : `FAIL (${got})`;
}
