// `./rig check`: the review's repro cases (CVM #1992) run against the verdict
// rules in judge.ts, plus clean cases that must still pass, plus the phone
// marker's synthetic runs (phone-checks.ts), plus the DirectShow listing
// parser fed a captured listing. No ffmpeg, no devices, a few seconds. `./rig selftest` runs these first.
import {
  arrivalsFromPts,
  cfrShift,
  frameVerdicts,
  judgeSync,
  lipSyncVsObs,
  lagFromRows,
  passed,
  previewVerdict,
  type MarkerRow,
} from "./judge.ts";
import { phoneCases } from "./phone-checks.ts";
import { listDshowDevicesRaw, type DshowListing } from "./win.ts";

type Case = { name: string; ok: () => boolean | string };

// What ffmpeg 8.0.1 printed for `-list_devices true -f dshow -i dummy` on the
// rig PC (2026-10-11): everything on stderr, CRLF, a mis-decoded "Elgato" name,
// and exit code 0. The rig read stderr only when ffmpeg exited non-zero, so the
// wizard reported "Found:" with nothing after it.
const DSHOW_8_0_1: DshowListing = {
  status: 0,
  stdout: "",
  stderr: [
    '[dshow @ 000001896faa4d00] "Cam Link 4K" (video)',
    '[dshow @ 000001896faa4d00]   Alternative name "@device_pnp_\\\\?\\usb#vid_0fd9&pid_0066&mi_00#7&337bb0b0&0&0000#{65e8773d-8f56-11d0-a3b9-00a0c9223196}\\global"',
    '[dshow @ 000001896faa4d00] "E\u00c2\u00a9lgato Virtual Camera" (video)',
    '[dshow @ 000001896faa4d00] "OBS Virtual Camera" (video)',
    '[dshow @ 000001896faa4d00] "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" (audio)',
    '[dshow @ 000001896faa4d00]   Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{CADBF361-A950-44FF-8CBA-BB8F4CB031D0}"',
    '[dshow @ 000001896faa4d00] "Microphone (Scarlett Solo USB)" (audio)',
    "Error opening input file dummy.",
    "",
  ].join("\r\n"),
};

const dshowFinds = (listing: DshowListing): true | string => {
  const { devices } = listDshowDevicesRaw(() => listing);
  const has = (kind: string, name: string) =>
    devices.some((d) => d.kind === kind && d.name.includes(name));
  if (!has("video", "Cam Link 4K") || !has("audio", "Voicemeeter Out B1"))
    return `parsed ${JSON.stringify(devices.map((d) => `${d.kind}:${d.name}`))}`;
  if (devices.length !== 5) return `${devices.length} devices, want 5`;
  return true;
};

const dshowCases: Case[] = [
  {
    name: "dshow: ffmpeg 8.0.1 listing (stderr, CRLF, exit 0) finds Cam Link 4K + Voicemeeter Out B1",
    ok: () => dshowFinds(DSHOW_8_0_1),
  },
  {
    name: "dshow: the same listing with exit 1 (older ffmpeg) still parses",
    ok: () => dshowFinds({ ...DSHOW_8_0_1, status: 1 }),
  },
  {
    name: "dshow: an unparseable listing returns its raw text for the error",
    ok: () => {
      const l = listDshowDevicesRaw(() => ({
        status: 0,
        stdout: "",
        stderr: "dummy: Immediate exit requested\r\n",
      }));
      return (
        (l.devices.length === 0 &&
          l.raw === "dummy: Immediate exit requested") ||
        JSON.stringify(l)
      );
    },
  },
];

// Deterministic jitter so every run of the checks sees the same data.
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** 15 markers over a 30-min take, offsets from f(t, i). */
function markerRows(
  f: (t: number, i: number) => { cs: number; as: number }
): MarkerRow[] {
  return Array.from({ length: 15 }, (_, i) => {
    const t = 60 + i * 120;
    const { cs, as } = f(t, i);
    return {
      expected: t,
      camMinusScreenMs: cs,
      audioMinusScreenMs: as,
      audioMinusCameraMs: Math.round((as - cs) * 10) / 10,
    };
  });
}

/** Arrival stamps (file seconds) at `fps` for `seconds`, with ±jitterMs read jitter, quantised to 1 ms like the rig's. */
function steadyArrivals(
  fps: number,
  seconds: number,
  jitterMs: number,
  seed = 1
) {
  const r = rng(seed);
  return Array.from(
    { length: Math.round(fps * seconds) },
    (_, i) => Math.round((i / fps) * 1000 + r() * jitterMs) / 1000
  );
}

const frames = (screen: number[], camera: number[]) =>
  frameVerdicts({
    screen: arrivalsFromPts(screen, 60, { rateLocked: true }),
    camera: arrivalsFromPts(camera, 30000 / 1001, { rateLocked: false }),
    lag: {},
    logDropWarnings: 0,
  });

const sawtooth = (t: number) => ((t * 0.3) % 33.4) - 16.7; // +300 ppm camera, one frame peak-to-peak

const cases: Case[] = [
  // ---- sync (H1, H2) ----
  {
    name: "H1: steady A/V drift 0 → 60 ms over 30 min fails",
    ok: () =>
      !passed(
        judgeSync(markerRows((t) => ({ cs: 0, as: (60 * (t - 60)) / 1680 })))
          .verdicts["A/V drift <= 33 ms"]
      ),
  },
  {
    name: "H1: uncorrected -300 ppm mic over a 5-min selftest (~-84 ms) fails",
    ok: () =>
      !passed(
        judgeSync(markerRows((_, i) => ({ cs: 0, as: 80 - 0.3 * i * 20 })))
          .verdicts["A/V drift <= 33 ms"]
      ),
  },
  {
    name: "H2: camera +40 / audio -40 vs screen (lip sync off by 80 ms) fails lip sync",
    ok: () =>
      !passed(
        judgeSync(
          markerRows((t) => {
            const x = (t - 60) / 1680;
            return { cs: 40 * x, as: -40 * x };
          })
        ).verdicts["lip sync (audio/camera) drift <= 33 ms"]
      ),
  },
  {
    name: "clean: flat offsets with ±5 ms marker jitter pass all three",
    ok: () => {
      const r = rng(7);
      const v = judgeSync(
        markerRows(() => ({
          cs: 10 + (r() - 0.5) * 10,
          as: 80 + (r() - 0.5) * 10,
        }))
      ).verdicts;
      return Object.values(v).every(passed) || JSON.stringify(v);
    },
  },
  {
    name: "cfrShift turns a +300 ppm camera's file-time onsets back into capture time (< 2 ms)",
    ok: () => {
      const fps = 30000 / 1001;
      const pts = Array.from(
        { length: Math.round(fps * 1800) },
        (_, i) => Math.round((i / fps / 1.0003 + 0.0123) * 1000) / 1000
      );
      let worst = 0;
      for (let w = 30; w < 1790; w += 20) {
        const capture = w + 0.05;
        const a = pts.reduce((b, p) =>
          Math.abs(p - capture) < Math.abs(b - capture) ? p : b
        );
        const fileOnset = capture + (Math.round(a * fps) / fps - a);
        worst = Math.max(
          worst,
          Math.abs(fileOnset - cfrShift(pts, fps, fileOnset) - capture)
        );
      }
      return worst < 0.002 || `worst ${Math.round(worst * 1000)} ms`;
    },
  },
  {
    name: "baseline (saw-tooth not removable): one slow 33 ms camera ramp passes, a 70 ms drift fails",
    ok: () => {
      const ramp = judgeSync(
        markerRows((t) => ({ cs: sawtooth(t / 15), as: 80 })),
        { cfrRemoved: false }
      ).verdicts["camera/screen drift <= 33 ms"];
      const drift = judgeSync(
        markerRows((t) => ({ cs: (70 * (t - 60)) / 1680, as: 80 })),
        { cfrRemoved: false }
      ).verdicts["camera/screen drift <= 33 ms"];
      return (passed(ramp) && !passed(drift)) || `${ramp} / ${drift}`;
    },
  },
  {
    name: "a single 40 ms audio jump fails A/V",
    ok: () =>
      !passed(
        judgeSync(markerRows((_, i) => ({ cs: 0, as: i === 7 ? 120 : 80 })))
          .verdicts["A/V drift <= 33 ms"]
      ),
  },
  // ---- frames (H3, H4) ----
  {
    name: "clean: 60 / 29.97 fps arrivals with 8 ms read jitter pass",
    ok: () => {
      const v = frames(
        steadyArrivals(60, 300, 8),
        steadyArrivals(30000 / 1001, 300, 8, 2)
      );
      return (
        (passed(v["no dropped frames"]) &&
          passed(v["no capture stalls > 100 ms"])) ||
        JSON.stringify(v)
      );
    },
  },
  {
    name: "H4: 142 ms stall then an 8-frame burst every 10 s fails (stalls)",
    ok: () => {
      const pts: number[] = [];
      for (let i = 0; i < 18000; i++) {
        const k = i % 600;
        pts.push(
          i > 300 && k >= 1 && k <= 8
            ? (i - k) / 60 + 0.142 + k * 0.0005
            : i / 60
        );
      }
      const a = arrivalsFromPts(pts, 60, { rateLocked: true })!;
      const v = frames(pts, steadyArrivals(30000 / 1001, 300, 8));
      return (
        (a.stalls.count > 0 && !passed(v["no capture stalls > 100 ms"])) ||
        JSON.stringify(a.stalls)
      );
    },
  },
  {
    name: "H3: screen at 59.45 fps (~31 frames short in 60 s) fails",
    ok: () =>
      !passed(
        frames(
          steadyArrivals(59.45, 63, 4),
          steadyArrivals(30000 / 1001, 63, 4)
        )["no dropped frames"]
      ),
  },
  {
    name: "H3: screen at 45.7 fps fails",
    ok: () =>
      !passed(
        frames(
          steadyArrivals(45.7, 63, 4),
          steadyArrivals(30000 / 1001, 63, 4)
        )["no dropped frames"]
      ),
  },
  {
    name: "camera losing 3 frames for good fails",
    ok: () => {
      const cam = steadyArrivals(30000 / 1001, 120, 4).map((t, i) =>
        i > 1800 ? t + 3 * (1001 / 30000) : t
      );
      return !passed(
        frames(steadyArrivals(60, 120, 4), cam)["no dropped frames"]
      );
    },
  },
  // ---- pipeline lag (M1) ----
  ...(() => {
    const rows = (lagAt: (out: number) => number) =>
      Array.from({ length: 1800 }, (_, k) => {
        const out = k + 1;
        return { out, winMs: 1e12 + (out + lagAt(out)) * 1000 + (k % 3) * 4 };
      });
    const lag = (f: (o: number) => number) => lagFromRows(rows(f), 1e12)!;
    return [
      {
        name: "M1: constant 0.5 s lag (no growth) passes",
        ok: () =>
          lag(() => 0.5).maxLagGrowthSec <= 0.05 ||
          JSON.stringify(lag(() => 0.5)),
      },
      {
        name: "M1: lag growing +0.7 s over the last 200 s fails",
        ok: () => {
          const l = lag((o) => 0.1 + (o > 1600 ? (0.7 * (o - 1600)) / 200 : 0));
          return (
            (Math.abs(l.maxLagGrowthSec - 0.7) < 0.05 &&
              !passed(
                frameVerdicts({
                  screen: null,
                  camera: null,
                  lag: { camera: l },
                  logDropWarnings: 0,
                })["recorder keeps up (lag growth <= 0.5 s)"]
              )) ||
            JSON.stringify(l)
          );
        },
      },
    ];
  })(),
  // ---- lip sync against OBS, the clap's replacement (unattended run) ----
  {
    name: "H2: rig's audio - camera median 12 ms off OBS's passes lip sync vs OBS",
    ok: () =>
      passed(lipSyncVsObs(-38, -50).verdict) ||
      JSON.stringify(lipSyncVsObs(-38, -50)),
  },
  {
    name: "H2: rig's audio - camera median 60 ms off OBS's fails lip sync vs OBS",
    ok: () =>
      (!passed(lipSyncVsObs(10, -50).verdict) &&
        lipSyncVsObs(10, -50).deltaMs === 60) ||
      JSON.stringify(lipSyncVsObs(10, -50)),
  },
  {
    name: "H2: no baseline median is n/a, not a pass",
    ok: () => lipSyncVsObs(-5, null).verdict.startsWith("n/a"),
  },
  // ---- preview (M2) ----
  {
    name: "M2: 0 preview frames fails",
    ok: () =>
      !passed(
        previewVerdict({
          screen: { frames: 0, firstFrameSec: null, maxGapSec: 300 },
          camera: { frames: 9000, firstFrameSec: 1.2, maxGapSec: 0.2 },
        })
      ),
  },
  {
    name: "clean: both preview feeds live passes",
    ok: () =>
      passed(
        previewVerdict({
          screen: { frames: 9000, firstFrameSec: 1.5, maxGapSec: 0.3 },
          camera: { frames: 9000, firstFrameSec: 1.2, maxGapSec: 0.2 },
        })
      ),
  },
  ...phoneCases,
  ...dshowCases,
];

export function runChecks(log: (...a: unknown[]) => void): boolean {
  let failed = 0;
  for (const c of cases) {
    const r = c.ok();
    if (r !== true) {
      failed++;
      log(`check FAIL: ${c.name}${typeof r === "string" ? ` → ${r}` : ""}`);
    }
  }
  log(`verdict-rule checks: ${cases.length - failed}/${cases.length} pass`);
  return failed === 0;
}
