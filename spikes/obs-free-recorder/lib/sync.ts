// Sync-marker detection, as pure functions over sample arrays: no ffmpeg, no
// files. analyze.ts decodes the runs and hands the series in; checks.ts hands
// in synthetic ones with known offsets, so every step from "a flash in the
// camera, a beep in the mic" to a verdict is tested without a device.
//
// Two marker sources:
//  - the PC: the page flashes the DELL white and plays a 1 kHz beep every
//    --flash-every minutes (A/V drift: mic 1 kHz - screen);
//  - the phone: a video on a phone in front of the camera flashes white and
//    beeps at 2 kHz every 10 s (lip sync: mic 2 kHz - camera). Its times are
//    unknown to the PC, so its onsets are found over the whole run and kept
//    only if they sit on a self-calibrated 10 s grid.
// Camera/screen drift is derived from the two: (mic 1 kHz - screen) -
// (mic 2 kHz - camera). The mic and the phone's own A/V offset cancel.
import { median } from "./judge.ts";

export type Series = { t: number[]; v: number[] };

/** Tone analysis window: 20 ms, 1 ms hop, at 8 kHz. Both tones sit on a bin centre (50 Hz bins), so a steady 1 kHz tone reads 0 at 2 kHz and back. */
export const TONE = { sr: 8000, win: 160, hop: 8 };
/** Each tone sample is stamped at its window's END, so a step onset reads half a window (10 ms) late. A constant: it cancels in every drift and in "vs OBS". */
export const TONE_BIAS_SEC = TONE.win / TONE.sr / 2;

export const PC_BEEP_HZ = 1000;
export const PHONE_BEEP_HZ = 2000;

/**
 * Amplitude of `freq` in a sliding window (DFT bin magnitude / (N/2), i.e. the
 * same number Goertzel gives), stamped at each window's end. Block sums keep it
 * linear in the run's length, so a 30 min mic decodes in about a second.
 */
export function toneSeries(
  x: Float64Array,
  freq: number,
  startTime: number,
  o = TONE
): Series {
  const w = (2 * Math.PI * freq) / o.sr;
  // Both tones divide the rate, so cos/sin repeat every sr/freq samples.
  const period = o.sr % freq === 0 ? o.sr / freq : 0;
  const cosT = Array.from({ length: period }, (_, i) => Math.cos(w * i));
  const sinT = Array.from({ length: period }, (_, i) => Math.sin(w * i));
  const blocks = Math.floor(x.length / o.hop);
  const pc = new Float64Array(blocks + 1);
  const ps = new Float64Array(blocks + 1);
  for (let b = 0; b < blocks; b++) {
    let c = 0;
    let s = 0;
    for (let k = 0; k < o.hop; k++) {
      const i = b * o.hop + k;
      c += x[i]! * (period ? cosT[i % period]! : Math.cos(w * i));
      s += x[i]! * (period ? sinT[i % period]! : Math.sin(w * i));
    }
    pc[b + 1] = pc[b]! + c;
    ps[b + 1] = ps[b]! + s;
  }
  const per = o.win / o.hop;
  const t: number[] = [];
  const v: number[] = [];
  for (let b = 0; b + per <= blocks; b++) {
    const c = pc[b + per]! - pc[b]!;
    const s = ps[b + per]! - ps[b]!;
    t.push(startTime + (b * o.hop + o.win) / o.sr);
    v.push(Math.hypot(c, s) / (o.win / 2));
  }
  return { t, v };
}

/** Index of the first t >= x (series t sorted). */
function lowerBound(t: number[], x: number) {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m]! < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function slice(s: Series, from: number, to: number): Series {
  const a = lowerBound(s.t, from);
  const b = lowerBound(s.t, to);
  return { t: s.t.slice(a, b), v: s.v.slice(a, b) };
}

/**
 * The PC marker's onset near a known time: where the series first crosses
 * halfway from its pre-marker level to its peak (linear interpolation), within
 * `expected` ±2 s. `rival` (the other tone, same time grid) rejects a peak the
 * other tone is stronger at: a harmonic or leakage, not this beep.
 */
export function onsetNear(
  full: Series,
  expected: number,
  minRise: number,
  rival?: Series
): number | null {
  const series = slice(full, expected - 2, expected + 2);
  if (!series.v.length) return null;
  const pre = series.v.filter((_, i) => series.t[i]! < expected - 0.6);
  const base = median(pre.length >= 5 ? pre : series.v.slice(0, 10));
  let peakI = 0;
  for (let i = 1; i < series.v.length; i++)
    if (series.v[i]! > series.v[peakI]!) peakI = i;
  const peak = series.v[peakI]!;
  if (!(peak - base >= minRise)) return null;
  if (rival) {
    const r = rival.v[lowerBound(rival.t, series.t[peakI]!)];
    if (r !== undefined && r * 2 > peak) return null;
  }
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

export type Onset = { t: number; rise: number; durSec: number };
export type Rejected = { t: number; why: string };

/**
 * Every onset in a whole-run series, with no expected time: a rise of at least
 * `minRise` over the level just before it, timed at the halfway crossing, and
 * lasting [minDur, maxDur] above that halfway level. `rival` drops an onset
 * whose peak is not at least twice the other tone's level at that moment (the
 * PC's 1 kHz beep has a 2 kHz harmonic in a speaker; this keeps it out).
 */
export function findOnsets(
  s: Series,
  o: {
    minRise: number;
    minDurSec: number;
    maxDurSec: number;
    rival?: Series;
  }
): { onsets: Onset[]; rejected: Rejected[] } {
  const onsets: Onset[] = [];
  const rejected: Rejected[] = [];
  const n = s.v.length;
  if (n < 3) return { onsets, rejected };
  // Global floor: the series is quiet/dark most of the time, so its median is
  // the resting level. A candidate must clear it by minRise.
  const floor = median(
    s.v.length > 200_000 ? s.v.filter((_, i) => i % 7 === 0) : s.v
  );
  let i = 1;
  while (i < n) {
    if (s.v[i]! < floor + o.minRise) {
      i++;
      continue;
    }
    const tc = s.t[i]!;
    // The local level just before (not the global one: room light and noise move).
    const pre = slice(s, tc - 1.0, tc - 0.15).v;
    const base = pre.length >= 3 ? median(pre) : floor;
    // This bump only: from the candidate while it stays above half the
    // minimum rise (a later, brighter marker must not swallow it).
    const a0 = lowerBound(s.t, tc - 0.15);
    let peakI = i;
    for (let k = i; k < n && s.v[k]! >= base + o.minRise / 2; k++)
      if (s.v[k]! > s.v[peakI]!) peakI = k;
    const peak = s.v[peakI]!;
    const thr = base + 0.5 * (peak - base);
    // Upward crossing at or before the peak.
    let up = peakI;
    while (up > a0 && s.v[up - 1]! >= thr) up--;
    // Downward crossing after the peak.
    let down = peakI;
    while (down < n - 1 && s.v[down + 1]! >= thr) down++;
    const resume = Math.max(down + 1, lowerBound(s.t, s.t[peakI]! + 0.3));
    const t =
      up > 0 && s.v[up - 1]! < thr
        ? s.t[up - 1]! +
          ((thr - s.v[up - 1]!) / (s.v[up]! - s.v[up - 1]!)) *
            (s.t[up]! - s.t[up - 1]!)
        : s.t[up]!;
    const durSec = s.t[down]! - t;
    i = resume;
    if (peak - base < o.minRise) continue; // a slow rise in the room, not a marker
    if (durSec < o.minDurSec || durSec > o.maxDurSec) {
      rejected.push({ t, why: `lasts ${Math.round(durSec * 1000)} ms` });
      continue;
    }
    if (o.rival) {
      const r = o.rival.v[lowerBound(o.rival.t, s.t[peakI]!)];
      if (r !== undefined && r * 2 > peak) {
        rejected.push({ t, why: "the other tone is as strong (harmonic)" });
        continue;
      }
    }
    onsets.push({ t, rise: peak - base, durSec });
  }
  return { onsets, rejected };
}

/**
 * Keeps the onsets that sit on one grid of ~`period` s, and measures that
 * grid: the phone's clock is its own (tens of ppm off the PC's), so the
 * period is fitted rather than assumed. A stray onset (a reflection of the
 * DELL flash, someone walking past) falls off the grid.
 */
export function fitGrid(times: number[], period: number) {
  const t = [...times].sort((a, b) => a - b);
  const empty = {
    kept: t,
    periodSec: null as number | null,
    offGrid: [] as number[],
  };
  if (t.length < 2) return empty;
  const near = (x: number, tol: number) =>
    Math.abs(x - Math.round(x / period) * period) < tol;
  // Anchor on the onset most others agree with (loose: up to 0.4 s of phone clock error).
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t.filter((x) => near(x - t[i]!, 0.4)).length;
    if (c > bestCount) {
      best = i;
      bestCount = c;
    }
  }
  let kept = t.filter((x) => near(x - t[best]!, 0.4));
  // Least-squares line t = a + P·k, then a tight cut around it.
  let a = t[best]!;
  let P = period;
  for (let pass = 0; pass < 2 && kept.length >= 2; pass++) {
    const k = kept.map((x) => Math.round((x - a) / P));
    const mk = k.reduce((s, x) => s + x, 0) / k.length;
    const mt = kept.reduce((s, x) => s + x, 0) / kept.length;
    const den = k.reduce((s, x) => s + (x - mk) ** 2, 0);
    if (den > 0) {
      P = k.reduce((s, x, j) => s + (x - mk) * (kept[j]! - mt), 0) / den;
      a = mt - P * mk;
    } else a = mt - P * mk;
    const res = (x: number) => x - (a + P * Math.round((x - a) / P));
    kept = t.filter((x) => Math.abs(res(x)) < 0.15);
  }
  return {
    kept,
    periodSec: kept.length >= 2 ? P : null,
    offGrid: t.filter((x) => !kept.includes(x)),
  };
}

export type PhonePair = {
  /** Camera onset in file time (s), as found. */
  camera: number;
  /** Camera onset with the CFR step's shift undone (capture time). */
  cameraCap: number;
  audio: number;
};

/**
 * Pairs each on-grid camera flash with the 2 kHz beep nearest to it (within
 * ±0.5 s; markers are 10 s apart). Pairs within 1.5 s of a PC marker are
 * dropped: the DELL flash lights the room and the 1 kHz beep's harmonic is at
 * 2 kHz, so either could bend the onset.
 */
export function pairPhone(
  camera: number[],
  audio: number[],
  pcMarkers: number[],
  cfr: (t: number) => number = () => 0
) {
  const pairs: PhonePair[] = [];
  let unpaired = 0;
  let nearPc = 0;
  for (const c of camera) {
    if (pcMarkers.some((p) => Math.abs(p - c) < 1.5)) {
      nearPc++;
      continue;
    }
    let best: number | null = null;
    for (const a of audio)
      if (
        Math.abs(a - c) < 0.5 &&
        (best === null || Math.abs(a - c) < Math.abs(best - c))
      )
        best = a;
    if (best === null) unpaired++;
    else pairs.push({ camera: c, cameraCap: c - cfr(c), audio: best });
  }
  return { pairs, unpaired, nearPc };
}

const ms = (a: number | null, b: number | null) =>
  a === null || b === null ? null : Math.round((a - b) * 10000) / 10;

/** One sync row per marker. judgeSync (judge.ts) reads the three offset columns, each ignoring nulls. */
export type SyncRow = {
  marker: string;
  /** File time of the marker (s): the drift trend's x axis. */
  expected: number;
  camMinusScreenMs: number | null;
  audioMinusScreenMs: number | null;
  audioMinusCameraMs: number | null;
};

export type PcPoint = {
  label: string;
  expected: number;
  /** Screen onset, capture time, moved to the beep's schedule (see pcScreenOnset). */
  screen: number | null;
  /** How long the page drew its flash after the beep's scheduled time (ms; events.jsonl). */
  flashLateMs?: number | null;
  /** Mic 1 kHz onset. */
  audio: number | null;
};

/**
 * Phone-marker rows: lip sync (mic 2 kHz - camera) at every phone pair, A/V
 * (mic 1 kHz - screen) at every PC marker, and camera/screen at every PC
 * marker derived as A/V minus the lip sync around it (median of the phone
 * pairs within ±15 s):
 *   (mic1k - screen) - (mic2k - camera) = camera - screen + const
 * where const is the phone's own A/V offset plus the speakers' latency
 * difference, both fixed. So its trend and jumps are the camera's against the
 * screen; its median is not an absolute offset.
 */
export function phoneSyncRows(pc: PcPoint[], phone: PhonePair[]) {
  const lip = phone.map((p) => ({
    t: p.cameraCap,
    v: ms(p.audio, p.cameraCap)!,
    file: ms(p.audio, p.camera)!,
  }));
  const pcRows = pc.map((m) => {
    const av = ms(m.audio, m.screen);
    const around = lip.filter((l) => Math.abs(l.t - m.expected) <= 15);
    const lipHere = around.length ? median(around.map((l) => l.v)) : null;
    return {
      marker: m.label,
      expected: Math.round(m.expected * 1000) / 1000,
      screen: m.screen,
      audio: m.audio,
      audioMinusScreenMs: av,
      flashLateMs: m.flashLateMs ?? null,
      lipSyncAroundMs: lipHere,
      camMinusScreenMs:
        av === null || lipHere === null
          ? null
          : Math.round((av - lipHere) * 10) / 10,
    };
  });
  const phoneRows = phone.map((p, i) => ({
    marker: `phone ${i + 1}`,
    expected: Math.round(p.cameraCap * 1000) / 1000,
    camera: Math.round(p.camera * 10000) / 10000,
    audio: Math.round(p.audio * 10000) / 10000,
    audioMinusCameraMs: lip[i]!.v,
    fileTimeAudioMinusCameraMs: lip[i]!.file,
  }));
  const rows: SyncRow[] = [
    ...pcRows.map((r) => ({
      marker: r.marker,
      expected: r.expected,
      camMinusScreenMs: r.camMinusScreenMs,
      audioMinusScreenMs: r.audioMinusScreenMs,
      audioMinusCameraMs: null,
    })),
    ...phoneRows.map((r) => ({
      marker: r.marker,
      expected: r.expected,
      camMinusScreenMs: null,
      audioMinusScreenMs: null,
      audioMinusCameraMs: r.audioMinusCameraMs,
    })),
  ];
  return { rows, pcRows, phoneRows };
}

/** Detector settings for the phone markers, shared by analyze.ts and checks.ts. */
export const PHONE_DETECT = {
  period: 10,
  camera: { minRise: 8, minDurSec: 0.08, maxDurSec: 0.6 },
  // The phone's beep lasts 100 ms; the PC's 250 ms beep (or its harmonic) can't pass.
  mic: { minRise: 0.002, minDurSec: 0.05, maxDurSec: 0.18 },
};

/** The whole phone path: camera luma + both mic tones → pairs and stats. */
export function detectPhone(
  camera: Series,
  mic1k: Series,
  mic2k: Series,
  pcMarkers: number[],
  cfr?: (t: number) => number
) {
  const cam = findOnsets(camera, PHONE_DETECT.camera);
  const grid = fitGrid(
    cam.onsets.map((o) => o.t),
    PHONE_DETECT.period
  );
  const mic = findOnsets(mic2k, { ...PHONE_DETECT.mic, rival: mic1k });
  const paired = pairPhone(
    grid.kept,
    mic.onsets.map((o) => o.t),
    pcMarkers,
    cfr
  );
  return {
    ...paired,
    summary: {
      cameraOnsets: cam.onsets.length,
      cameraOffGrid: grid.offGrid.length,
      cameraRejected: cam.rejected.length,
      micOnsets: mic.onsets.length,
      micRejected: mic.rejected.length,
      micRejectedWhy: [...new Set(mic.rejected.map((r) => r.why))].slice(0, 5),
      periodSec:
        grid.periodSec === null ? null : Math.round(grid.periodSec * 1e6) / 1e6,
      periodPpm:
        grid.periodSec === null
          ? null
          : Math.round((grid.periodSec / PHONE_DETECT.period - 1) * 1e6),
      pairs: paired.pairs.length,
      unpaired: paired.unpaired,
      droppedNearPcMarker: paired.nearPc,
    },
  };
}

/**
 * The page schedules the PC beep on the audio clock for a wall-clock boundary,
 * but draws its flash on the first animation frame at or after it: 4 ms early
 * to 26 ms late on the rig PC (events.jsonl: wallMs vs beepWallMs). That
 * per-marker difference is the page's, not the recorder's, so the screen onset
 * is moved by it, to where it would be had the flash gone up exactly at the
 * beep's time. A marker with no scheduled beep (a manual flash) is left as is.
 */
export function pcScreenOnset(
  screen: number | null,
  m: { expected: number; beepAt?: number }
): number | null {
  if (screen === null || m.beepAt === undefined) return screen;
  return screen - (m.expected - m.beepAt);
}

export const flashLateMs = (m: { expected: number; beepAt?: number }) =>
  m.beepAt === undefined
    ? null
    : Math.round((m.expected - m.beepAt) * 10000) / 10;

/**
 * The PC marker (DELL flash + 1 kHz) and phone marker (flash + 2 kHz) path for
 * a real run, from decoded inputs to sync rows. analyze.ts feeds it ffmpeg's
 * output; checks.ts feeds it synthetic series with injected offsets.
 */
export function analyzePhoneMarkers(i: {
  /** `expected`: file time the page drew the flash; `beepAt`: the beep's scheduled file time. */
  marks: { label: string; expected: number; beepAt?: number }[];
  /** Screen luma around a marker (±2 s), and the CFR shift to undo. */
  screenAround: (expected: number) => Series;
  screenCfr: (t: number) => number;
  /** Camera luma over the whole run. */
  camera: Series;
  cameraCfr: (t: number) => number;
  mic1k: Series;
  mic2k: Series;
  /** False in the preflight: it only asks whether each marker is seen and heard. */
  excludeNearPc: boolean;
}) {
  const pc: PcPoint[] = i.marks.map((m) => {
    const screen = onsetNear(i.screenAround(m.expected), m.expected, 25);
    return {
      label: m.label,
      expected: m.expected,
      screen: pcScreenOnset(
        screen === null ? null : screen - i.screenCfr(screen),
        m
      ),
      flashLateMs: flashLateMs(m),
      audio: onsetNear(i.mic1k, m.expected, 0.002, i.mic2k),
    };
  });
  const found = detectPhone(
    i.camera,
    i.mic1k,
    i.mic2k,
    i.excludeNearPc ? i.marks.map((m) => m.expected) : [],
    i.cameraCfr
  );
  return { ...phoneSyncRows(pc, found.pairs), summary: found.summary };
}

/**
 * The PC beep's delay into the mic (ms): from the moment the page scheduled it
 * to its onset in the mic, less the tone window's half-width and Chrome's own
 * output latency. Near 0 means it never crossed the room (judgePreflight).
 */
export function pcBeepDelayMs(
  mic1k: Series,
  mic2k: Series | undefined,
  beepAt: number,
  chromeOutputLatencySec: number
): number | null {
  const a = onsetNear(mic1k, beepAt, 0.002, mic2k);
  return a === null
    ? null
    : Math.round(
        (a - TONE_BIAS_SEC - beepAt - chromeOutputLatencySec) * 10000
      ) / 10;
}
