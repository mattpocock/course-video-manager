// `./rig check`, phone-marker cases: a synthetic "camera sees the phone"
// luma series, a synthetic screen, and a synthetic mic holding both the PC's
// 1 kHz beep (with a strong 2 kHz harmonic, as a small speaker makes) and the
// phone's 2 kHz beep, with known, injected latencies and drifts. They go
// through the same code analyze.ts runs on a real record (analyzePhoneMarkers
// → judgeSync → lipSyncVsObs), so each verdict is checked against the value
// that was injected. No ffmpeg, no device.
import {
  CAMERA_FRAME_MS,
  judgePreflight,
  judgeSync,
  lipSyncVsObs,
  passed,
} from "./judge.ts";
import {
  analyzePhoneMarkers,
  findOnsets,
  onsetNear,
  PC_BEEP_HZ,
  pcBeepDelayMs,
  PHONE_BEEP_HZ,
  PHONE_DETECT,
  TONE,
  TONE_BIAS_SEC,
  toneSeries,
  type Series,
} from "./sync.ts";

type Case = { name: string; ok: () => boolean | string };

const DURATION = 600; // s
const PC_EVERY = 60; // s (a real run: 2 min)
const CAM_FPS = 30000 / 1001;
const PHONE = { period: 10.0004, flash: 0.2, beep: 0.1 }; // phone clock 40 ppm slow

/** Latencies (s) at file time t; drifts ramp linearly 0 → drift over the run. */
type Room = {
  /** The phone's own A/V offset: its beep leaves the speaker this long after its flash is lit. */
  phoneAV: number;
  /** First phone flash (s). */
  phonePhase: number;
  camera: number;
  cameraDrift?: number;
  screen: number;
  screenDrift?: number;
  mic: number;
  micDrift?: number;
  /** The PC speakers' latency for the 1 kHz beep. */
  speakers: number;
  /** Beeps the mic gets straight from Voicemeeter (no air): speakers = 0. */
  noPcBeep?: boolean;
  noPhone?: boolean;
  /** Extra camera flashes off the phone's grid (a DELL reflection, someone walking past). */
  strays?: number[];
};

const at = (base: number, drift: number | undefined, t: number) =>
  base + ((drift ?? 0) * t) / DURATION;

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

const phoneFlashes = (r: Room) => {
  const out: number[] = [];
  for (let k = 0; r.phonePhase + k * PHONE.period < DURATION - 1; k++)
    out.push(r.phonePhase + k * PHONE.period);
  return out;
};
const pcMarks = () =>
  Array.from({ length: Math.floor(DURATION / PC_EVERY) - 1 }, (_, k) => ({
    label: `pc ${k + 1}`,
    expected: (k + 1) * PC_EVERY,
  }));

/** Fraction of the exposure (d s, ending at T) lit by any of `flashes` [start, start + len). */
function lit(T: number, d: number, flashes: number[], len: number) {
  let f = 0;
  for (const s of flashes) {
    if (s > T || s + len < T - d) continue;
    f += Math.max(0, Math.min(T, s + len) - Math.max(T - d, s)) / d;
  }
  return Math.min(1, f);
}

/** The camera: dim room (luma 30), the phone fills a quarter of the view; the DELL's flash lights the room a little. */
function cameraSeries(r: Room, seed = 3): Series {
  const n = Math.floor(DURATION * CAM_FPS);
  const d = 1 / CAM_FPS;
  const rand = rng(seed);
  const flashes = r.noPhone
    ? []
    : phoneFlashes(r).map((F) => F + at(r.camera, r.cameraDrift, F));
  const strays = (r.strays ?? []).map((s) => s + r.camera);
  const dell = pcMarks().map((m) => m.expected + r.camera);
  const t: number[] = [];
  const v: number[] = [];
  for (let k = 0; k < n; k++) {
    const T = k * d;
    t.push(T);
    v.push(
      30 +
        0.25 * 200 * lit(T, d, flashes, PHONE.flash) +
        25 * lit(T, d, strays, 0.25) +
        4 * lit(T, d, dell, 0.25) +
        (rand() - 0.5) * 3
    );
  }
  return { t, v };
}

/** The screen around a PC marker: the page's fullscreen flash at 60 fps. */
function screenAround(r: Room) {
  return (expected: number): Series => {
    const t: number[] = [];
    const v: number[] = [];
    const flash = [expected + at(r.screen, r.screenDrift, expected)];
    for (let k = Math.ceil((expected - 2) * 60); k < (expected + 2) * 60; k++) {
      t.push(k / 60);
      v.push(20 + 215 * lit(k / 60, 1 / 60, flash, 0.25));
    }
    return { t, v };
  };
}

/** The mic at TONE.sr: room noise, the PC beep (1 kHz + a 30% 2 kHz harmonic), the phone's 2 kHz beep. */
function micSamples(r: Room, seed = 5): Float64Array {
  const sr = TONE.sr;
  const x = new Float64Array(DURATION * sr);
  const rand = rng(seed);
  for (let i = 0; i < x.length; i++) x[i] = 0.004 * (2 * rand() - 1);
  const tone = (start: number, len: number, parts: [number, number][]) => {
    const i0 = Math.ceil(start * sr);
    for (let i = i0; i < Math.min(x.length, (start + len) * sr); i++)
      for (const [hz, amp] of parts)
        x[i] = x[i]! + amp * Math.sin(2 * Math.PI * hz * (i / sr - start));
  };
  if (!r.noPcBeep)
    for (const m of pcMarks()) {
      const t = m.expected;
      tone(t + r.speakers + at(r.mic, r.micDrift, t), 0.25, [
        [PC_BEEP_HZ, 0.05],
        [2 * PC_BEEP_HZ, 0.015],
      ]);
    }
  if (!r.noPhone)
    for (const F of phoneFlashes(r))
      tone(F + r.phoneAV + at(r.mic, r.micDrift, F), PHONE.beep, [
        [PHONE_BEEP_HZ, 0.04],
      ]);
  return x;
}

function run(r: Room) {
  const x = micSamples(r);
  const mic1k = toneSeries(x, PC_BEEP_HZ, 0);
  const mic2k = toneSeries(x, PHONE_BEEP_HZ, 0);
  const a = analyzePhoneMarkers({
    marks: pcMarks(),
    screenAround: screenAround(r),
    screenCfr: () => 0,
    camera: cameraSeries(r),
    cameraCfr: () => 0,
    mic1k,
    mic2k,
    excludeNearPc: true,
  });
  return { ...a, ...judgeSync(a.rows), mic1k, mic2k };
}

// What each detector reads for a step at time F: the tone at its window's
// half-width, a video flash half an exposure in (a sub-frame estimate).
const CAM_HALF = CAMERA_FRAME_MS / 2 / 1000;
const SCREEN_HALF = 1 / 60 / 2;
/** The offsets an exact detector would read for `r` (ms), without drift. */
const expected = (r: Room) => {
  const lip = r.phoneAV + r.mic - r.camera + TONE_BIAS_SEC - CAM_HALF;
  const av = r.speakers + r.mic - r.screen + TONE_BIAS_SEC - SCREEN_HALF;
  return { lip: lip * 1000, av: av * 1000, cs: (av - lip) * 1000 };
};

const ROOM: Room = {
  phoneAV: 0.137,
  phonePhase: 3.7,
  camera: 0.045,
  screen: 0.012,
  mic: 0.021,
  speakers: 0.006,
};

const KEYS = {
  av: "A/V drift <= 33 ms",
  cs: "camera/screen drift <= 33 ms",
  lip: "lip sync (audio/camera) drift <= 33 ms",
} as const;

/** Checks each pair's median against `want` and its trend against `trend` (ms), within tol. */
function reads(
  r: ReturnType<typeof run>,
  want: { av: number; cs: number; lip: number },
  trend: { av: number; cs: number; lip: number },
  tol = 4
) {
  const got = {
    av: r.sync.audioMinusScreen,
    cs: r.sync.camMinusScreen,
    lip: r.sync.audioMinusCamera,
  };
  const bad: string[] = [];
  for (const k of ["av", "cs", "lip"] as const) {
    if (Math.abs(got[k].medianMs! - want[k]) > tol)
      bad.push(
        `${k} median ${got[k].medianMs} want ${Math.round(want[k] * 10) / 10}`
      );
    if (Math.abs(got[k].trendMs! - trend[k]) > tol + 1)
      bad.push(
        `${k} trend ${got[k].trendMs} want ${Math.round(trend[k] * 10) / 10}`
      );
  }
  return bad;
}

/** The fraction of a run-long drift that lands between the first and the last marker of a pair. */
const span = (r: ReturnType<typeof run>, which: "pc" | "phone") => {
  const ts =
    which === "pc"
      ? r.pcRows.map((x) => x.expected)
      : r.phoneRows.map((x) => x.expected);
  return (Math.max(...ts) - Math.min(...ts)) / DURATION;
};

export const phoneCases: Case[] = [
  {
    name: "phone: clean run (phone A/V 137 ms, strays off its grid): all three PASS, medians read the injected offsets",
    ok: () => {
      const room = { ...ROOM, strays: [125.3, 333.1, 401.9] };
      const r = run(room);
      const bad = reads(r, expected(room), { av: 0, cs: 0, lip: 0 });
      const want =
        Math.floor((DURATION - 1 - ROOM.phonePhase) / PHONE.period) + 1;
      if (r.summary.pairs !== want)
        bad.push(`pairs ${r.summary.pairs} want ${want}`);
      if (r.summary.cameraOffGrid !== 3)
        bad.push(`off-grid ${r.summary.cameraOffGrid} want 3 strays`);
      if (r.summary.micRejected < 9)
        bad.push(`only ${r.summary.micRejected} PC harmonics rejected`);
      if (Math.abs(r.summary.periodSec! - PHONE.period) > 0.0002)
        bad.push(`period ${r.summary.periodSec}`);
      for (const k of Object.values(KEYS))
        if (!passed(r.verdicts[k])) bad.push(`${k}: ${r.verdicts[k]}`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: camera drifting 0 → 60 ms FAILs camera/screen and lip sync, A/V PASSes; trends read +60 / -60",
    ok: () => {
      const room = { ...ROOM, cameraDrift: 0.06 };
      const r = run(room);
      const bad = reads(
        r,
        {
          ...expected(room),
          cs: r.sync.camMinusScreen.medianMs!,
          lip: r.sync.audioMinusCamera.medianMs!,
        },
        {
          av: 0,
          cs: 60 * span(r, "pc"),
          lip: -60 * span(r, "phone"),
        }
      );
      if (passed(r.verdicts[KEYS.cs]))
        bad.push(`camera/screen ${r.verdicts[KEYS.cs]}`);
      if (passed(r.verdicts[KEYS.lip]))
        bad.push(`lip sync ${r.verdicts[KEYS.lip]}`);
      if (!passed(r.verdicts[KEYS.av])) bad.push(`A/V ${r.verdicts[KEYS.av]}`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: mic drifting 0 → 60 ms FAILs A/V and lip sync; camera/screen PASSes (the mic cancels)",
    ok: () => {
      const room = { ...ROOM, micDrift: 0.06 };
      const r = run(room);
      const e = expected(room);
      const bad = reads(
        r,
        {
          av: r.sync.audioMinusScreen.medianMs!,
          cs: e.cs,
          lip: r.sync.audioMinusCamera.medianMs!,
        },
        {
          av: 60 * span(r, "pc"),
          cs: 0,
          lip: 60 * span(r, "phone"),
        }
      );
      if (passed(r.verdicts[KEYS.av])) bad.push(`A/V ${r.verdicts[KEYS.av]}`);
      if (passed(r.verdicts[KEYS.lip]))
        bad.push(`lip sync ${r.verdicts[KEYS.lip]}`);
      if (!passed(r.verdicts[KEYS.cs]))
        bad.push(`camera/screen ${r.verdicts[KEYS.cs]}`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: screen drifting 0 → 60 ms FAILs A/V and camera/screen; lip sync PASSes",
    ok: () => {
      const room = { ...ROOM, screenDrift: 0.06 };
      const r = run(room);
      const e = expected(room);
      const bad = reads(
        r,
        {
          av: r.sync.audioMinusScreen.medianMs!,
          cs: r.sync.camMinusScreen.medianMs!,
          lip: e.lip,
        },
        {
          av: -60 * span(r, "pc"),
          cs: -60 * span(r, "pc"),
          lip: 0,
        }
      );
      if (passed(r.verdicts[KEYS.av])) bad.push(`A/V ${r.verdicts[KEYS.av]}`);
      if (passed(r.verdicts[KEYS.cs]))
        bad.push(`camera/screen ${r.verdicts[KEYS.cs]}`);
      if (!passed(r.verdicts[KEYS.lip]))
        bad.push(`lip sync ${r.verdicts[KEYS.lip]}`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: a 45 ms camera jump for one minute FAILs camera/screen and lip sync (jump, not trend)",
    ok: () => {
      // A single step that comes back: the camera ran 45 ms late from 290 s to 350 s.
      const r0 = { ...ROOM };
      const cam = cameraSeries(r0);
      const late = cameraSeries({ ...r0, camera: r0.camera + 0.045 });
      const v = cam.v.map((x, i) =>
        cam.t[i]! >= 290 && cam.t[i]! < 350 ? late.v[i]! : x
      );
      const x = micSamples(r0);
      const a = analyzePhoneMarkers({
        marks: pcMarks(),
        screenAround: screenAround(r0),
        screenCfr: () => 0,
        camera: { t: cam.t, v },
        cameraCfr: () => 0,
        mic1k: toneSeries(x, PC_BEEP_HZ, 0),
        mic2k: toneSeries(x, PHONE_BEEP_HZ, 0),
        excludeNearPc: true,
      });
      const j = judgeSync(a.rows);
      const ok =
        /jump/.test(j.verdicts[KEYS.cs]) &&
        /jump/.test(j.verdicts[KEYS.lip]) &&
        passed(j.verdicts[KEYS.av]);
      return ok || JSON.stringify(j.verdicts);
    },
  },
  {
    name: "phone: no cross-detection: the PC beep's 2 kHz harmonic is never a phone beep, the phone's beep never a PC beep",
    ok: () => {
      const bad: string[] = [];
      // PC beeps only (with the harmonic): no 2 kHz onsets.
      const onlyPc = micSamples({ ...ROOM, noPhone: true });
      const pc1 = toneSeries(onlyPc, PC_BEEP_HZ, 0);
      const pc2 = toneSeries(onlyPc, PHONE_BEEP_HZ, 0);
      const f = findOnsets(pc2, { ...PHONE_DETECT.mic, rival: pc1 });
      if (f.onsets.length)
        bad.push(`${f.onsets.length} 2 kHz onsets from the PC beep`);
      // Even without the rival test, the beep's 250 ms shape keeps it out.
      const g = findOnsets(pc2, PHONE_DETECT.mic);
      if (g.onsets.length)
        bad.push(`${g.onsets.length} 2 kHz onsets on shape alone`);
      // Phone beeps only, a PC marker on top of each: no 1 kHz onset.
      const onlyPhone = micSamples({ ...ROOM, noPcBeep: true });
      const ph1 = toneSeries(onlyPhone, PC_BEEP_HZ, 0);
      const ph2 = toneSeries(onlyPhone, PHONE_BEEP_HZ, 0);
      const hits = phoneFlashes(ROOM)
        .map((F) => onsetNear(ph1, F + ROOM.phoneAV, 0.002, ph2))
        .filter((t) => t !== null).length;
      if (hits) bad.push(`${hits} 1 kHz onsets from the phone beep`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: phone flashes on top of PC markers are dropped, and the run still reads the injected offsets",
    ok: () => {
      const room = { ...ROOM, phonePhase: 0.4 };
      const r = run(room);
      const bad = reads(r, expected(room), { av: 0, cs: 0, lip: 0 });
      if (r.summary.droppedNearPcMarker < 9)
        bad.push(`dropped ${r.summary.droppedNearPcMarker}`);
      return bad.length ? bad.join("; ") : true;
    },
  },
  {
    name: "phone: lip sync vs OBS reads the rig's injected error, the phone's own 137 ms cancels (+10 ms PASS, +60 ms FAIL)",
    ok: () => {
      // OBS's pipeline: camera +80, audio +30 ms. The rig: camera +70 (10 ms
      // later lip sync), then audio +90 (60 ms later).
      const obs = run({
        ...ROOM,
        camera: ROOM.camera + 0.08,
        mic: ROOM.mic + 0.03,
      });
      const rig10 = run({
        ...ROOM,
        camera: ROOM.camera + 0.07,
        mic: ROOM.mic + 0.03,
      });
      const rig60 = run({
        ...ROOM,
        camera: ROOM.camera + 0.08,
        mic: ROOM.mic + 0.09,
      });
      const v10 = lipSyncVsObs(
        rig10.sync.audioMinusCamera.medianMs,
        obs.sync.audioMinusCamera.medianMs
      );
      const v60 = lipSyncVsObs(
        rig60.sync.audioMinusCamera.medianMs,
        obs.sync.audioMinusCamera.medianMs
      );
      const ok =
        Math.abs(v10.deltaMs! - 10) <= 3 &&
        passed(v10.verdict) &&
        Math.abs(v60.deltaMs! - 60) <= 3 &&
        !passed(v60.verdict);
      return ok || `${v10.verdict} / ${v60.verdict}`;
    },
  },
  {
    name: "preflight: an acoustic PC beep (+25 ms) PASSes; a digital one through Voicemeeter (+0 ms) FAILs and says why",
    ok: () => {
      const delays = (speakers: number) => {
        // mic at 0: the beep is in the mic `speakers` s after Chrome played it.
        const x = micSamples({ ...ROOM, mic: 0, speakers, noPhone: false });
        const m1 = toneSeries(x, PC_BEEP_HZ, 0);
        const m2 = toneSeries(x, PHONE_BEEP_HZ, 0);
        return pcMarks().map((m) => pcBeepDelayMs(m1, m2, m.expected, 0)!);
      };
      const judge = (d: number[]) =>
        judgePreflight({
          seconds: 40,
          pageStarted: true,
          sound: "running",
          phone: { cameraOnGrid: 4, micOnsets: 4, pairs: 4 },
          pcBeeps: { played: d.length, delaysMs: d },
        })["PC beep reaches the mic through the air"]!;
      const air = delays(0.025);
      const wire = delays(0);
      const a = judge(air);
      const w = judge(wire);
      const ok =
        air.every((d) => Math.abs(d - 25) < 1.5) &&
        wire.every((d) => Math.abs(d) < 1.5) &&
        passed(a) &&
        !passed(w) &&
        /Voicemeeter/.test(w);
      return ok || `${JSON.stringify({ air, wire })} ${a} / ${w}`;
    },
  },
  {
    name: "preflight: a camera that can't see the phone, or a silent phone, FAILs with what to fix",
    ok: () => {
      const base = {
        seconds: 40,
        pageStarted: true,
        sound: "running",
        pcBeeps: { played: 7, delaysMs: [30, 31, 29, 30, 30, 32, 30] },
      };
      const blind = judgePreflight({
        ...base,
        phone: { cameraOnGrid: 0, micOnsets: 4, pairs: 0 },
      });
      const mute = judgePreflight({
        ...base,
        phone: { cameraOnGrid: 4, micOnsets: 0, pairs: 0 },
      });
      const good = judgePreflight({
        ...base,
        phone: { cameraOnGrid: 4, micOnsets: 4, pairs: 4 },
      });
      const ok =
        /Prop the phone/.test(blind["camera sees the phone's flash"]!) &&
        /volume/.test(mute["mic hears the phone's 2 kHz beep"]!) &&
        Object.values(good).every(passed);
      return ok || JSON.stringify({ blind, mute, good });
    },
  },
];
