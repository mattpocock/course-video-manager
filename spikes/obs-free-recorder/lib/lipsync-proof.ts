// `./rig lipsync-proof`: the phone-marker analysis end to end, on files. No
// clap and no camera on the DELL: a phone in front of the camera flashes and
// beeps at 2 kHz every 10 s (lib/phone.ts), the page flashes the DELL and
// beeps at 1 kHz. The phone's own A/V offset is unknown, but it is the same in
// the OBS baseline and the rig's record run, so it cancels in "lip sync vs
// OBS" (judge.ts lipSyncVsObs), and drift needs no absolute value at all.
//
// It renders, with ffmpeg from lavfi only (no device, no capture, no OBS):
//  - an OBS-style baseline: one 1920x1080 60 fps file in the Code layout, the
//    screen flashing at each PC marker, the face-cam region showing the phone
//    (the phone's flash at 29.97 fps exposures), and a quiet, noisy mix of
//    the 1 kHz PC beep (with a 2 kHz harmonic) and the phone's 2 kHz beep;
//  - four rig record runs (screen.mkv, camera.mkv, mic.mkv) in the same room,
//    with an injected rig error: lip sync 10 ms late, 60 ms late, audio
//    drifting, camera drifting.
// Then it runs the real analysis (analyze.ts) on each and checks the verdicts.
// `./rig check` runs the same path on in-memory series (phone-checks.ts);
// this one adds ffmpeg's encode and decode.
import fs from "node:fs";
import path from "node:path";
import { analyze, type Meta } from "./analyze.ts";
import { ffmpeg } from "./ff.ts";
import { passed } from "./judge.ts";
import { FILES } from "./recorder.ts";

const DURATION = 200; // s
const PC = { first: 10, period: 20, len: 0.25 }; // the page's DELL flash + 1 kHz beep
const PHONE = { first: 3.7, period: 10, len: 0.2, beep: 0.1 }; // the phone video
const CAM_FPS = "30000/1001";

// The room: the same physical delays in every run (s after the page draws the
// flash, or after the phone lights its screen).
const ROOM = {
  screen: 0.005,
  cameraSeesPhone: 0.025,
  speakers: 0.03,
  phoneAV: 0.137,
};

type Marker = { first: number; period: number; len: number };

/**
 * Brightness of a frame whose exposure ends at T (fps), as a fraction of that
 * exposure lit by a flash starting `lat` s after each marker: the onset then
 * carries sub-frame timing, as with a real camera.
 */
function lit(m: Marker, lat: string, fpsExpr: string, tExpr = "T") {
  const d = `(1/(${fpsExpr}))`;
  const p = `mod(${tExpr}-${m.first}-${lat},${m.period})`;
  return `if(gte(${tExpr},${m.first}+${lat}),max(0,min(${p},${m.len})-max(${p}-${d},0))/${d},0)`;
}

/** A tone burst `lat` s (plus `driftPerSec`·t) after each marker. */
function burst(
  m: Marker,
  hz: number,
  amp: number,
  len: number,
  lat: number,
  driftPerSec = 0
) {
  const at = `(${m.first}+${lat}+${driftPerSec}*t)`;
  return `${amp}*sin(2*PI*${hz}*t)*gte(t,${at})*lt(mod(t-${at},${m.period}),${len})`;
}

/** The mic: PC beep (1 kHz, a 30% 2 kHz harmonic) and the phone's 2 kHz beep, quiet, in room noise. */
function micExpr(audio: number, driftPerSec = 0) {
  return [
    burst(PC, 1000, 0.05, PC.len, ROOM.speakers + audio, driftPerSec),
    burst(PC, 2000, 0.015, PC.len, ROOM.speakers + audio, driftPerSec),
    burst(PHONE, 2000, 0.04, PHONE.beep, ROOM.phoneAV + audio, driftPerSec),
    "0.004*(2*random(0)-1)",
  ].join("+");
}

type Case = {
  name: string;
  camera: number;
  audio: number;
  audioDriftPerSec?: number;
  cameraDriftPerSec?: number;
  expect: Record<string, boolean>;
};

const LIP = "lip sync (audio/camera) drift <= 33 ms";
const CS = "camera/screen drift <= 33 ms";
const AV = "A/V drift <= 33 ms";
const VS_OBS =
  "lip sync vs OBS (audio - camera median within 33 ms + 1 OBS frame of the baseline's)";
const SHORT: Record<string, string> = {
  [LIP]: "lip drift",
  [CS]: "cam/screen",
  [AV]: "A/V",
  [VS_OBS]: "vs OBS",
};

export async function runLipSyncProof(
  out: string,
  log: (...a: unknown[]) => void
): Promise<boolean> {
  const root = path.join(
    out,
    "lipsync-proof",
    new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  );
  const origin = 1_790_000_000_000; // any fixed wall time: file t=0
  const events = [
    JSON.stringify({
      type: "page-start",
      auto: true,
      audio: "running",
      wallMs: origin + 2000,
    }),
    ...Array.from(
      { length: Math.floor((DURATION - PC.first) / PC.period) + 1 },
      (_, k) => {
        const w = origin + (PC.first + k * PC.period) * 1000;
        return JSON.stringify({
          type: "flash",
          reason: "scheduled",
          wallMs: w,
          beepWallMs: w,
        });
      }
    ),
  ].join("\n");
  const run = (dir: string, args: string[]) => {
    const r = ffmpeg(["-y", "-v", "error", ...args], dir);
    if (r.stderr.trim()) log(r.stderr.trim().split("\n").slice(-3).join(" | "));
  };

  // ---- the OBS baseline: OBS's own pipeline adds camera 80 ms, audio 30 ms ----
  const obs = { camera: 0.08, audio: 0.03 };
  const bdir = path.join(root, "baseline");
  fs.mkdirSync(bdir, { recursive: true });
  log("lipsync-proof: rendering the OBS-style baseline…");
  // Code layout: screen at 0..1400 x 0..1080; face cam 491x716 at (1429,364),
  // where the phone fills the middle. The face cam's frames change at 29.97
  // fps inside the 60 fps canvas, as in OBS.
  const camT = `floor(T*${CAM_FPS})/(${CAM_FPS})`;
  const camLat = String(ROOM.cameraSeesPhone + obs.camera);
  run(bdir, [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=1920x1080:r=60:d=${DURATION}`,
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${micExpr(obs.audio)}':s=48000:d=${DURATION}`,
    // Each region is drawn at 16x16 (geq is per pixel) and scaled up.
    "-filter_complex",
    `color=c=black:s=16x16:r=60:d=${DURATION},format=gray,geq=lum='20+215*${lit(PC, String(ROOM.screen), "60")}',scale=1400:1080:flags=neighbor[s];` +
      `color=c=black:s=16x16:r=60:d=${DURATION},format=gray,geq=lum='20+200*${lit(PHONE, camLat, CAM_FPS, camT)}',scale=245:358:flags=neighbor[c];` +
      `[0:v]drawbox=x=1429:y=364:w=491:h=716:color=0x1e1e1e:t=fill[bg];[bg][s]overlay=0:0[b1];[b1][c]overlay=1552:543,format=yuv420p[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-g",
    "120",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "obs.mkv",
  ]);
  const bmeta: Meta = {
    mode: "baseline",
    t0Ms: origin,
    startedWallMs: origin,
    cameraMarker: "phone",
    logicalCpus: 32,
    obsFile: path.join(bdir, "obs.mkv"),
    obsFileStartWallMs: origin,
  };
  fs.writeFileSync(path.join(bdir, "meta.json"), JSON.stringify(bmeta));
  fs.writeFileSync(path.join(bdir, "events.jsonl"), events + "\n");
  const b = analyze(bdir);
  const results: string[] = [
    "| Run | audio - camera median | lip sync drift | camera/screen drift | A/V drift | lip sync vs OBS | expected | ok |",
    "|---|---|---|---|---|---|---|---|",
  ];
  let ok =
    passed(b.verdicts[LIP]) &&
    passed(b.verdicts[CS]) &&
    passed(b.verdicts[AV]) &&
    b.sync.audioMinusCamera.n >= 15;
  results.push(
    `| OBS baseline (camera +${obs.camera * 1000}, audio +${obs.audio * 1000} ms) | ${b.sync.audioMinusCamera.medianMs} ms (n=${b.sync.audioMinusCamera.n}) | ${b.verdicts[LIP]} | ${b.verdicts[CS]} | ${b.verdicts[AV]} | – | all drift PASS | ${ok ? "yes" : "NO"} |`
  );

  // ---- four rig runs in the same room ----
  const cases: Case[] = [
    {
      name: "rig: lip sync 10 ms later than OBS",
      camera: 0.07,
      audio: 0.03,
      expect: { [LIP]: true, [CS]: true, [AV]: true, [VS_OBS]: true },
    },
    {
      name: "rig: lip sync 60 ms later than OBS",
      camera: 0.08,
      audio: 0.09,
      expect: { [LIP]: true, [VS_OBS]: false },
    },
    {
      name: "rig: audio drifting 0 -> 60 ms",
      camera: 0.08,
      audio: 0.03,
      audioDriftPerSec: 0.06 / DURATION,
      expect: { [LIP]: false, [AV]: false, [CS]: true },
    },
    {
      name: "rig: camera drifting 0 -> 60 ms",
      camera: 0.08,
      audio: 0.03,
      cameraDriftPerSec: 0.06 / DURATION,
      expect: { [LIP]: false, [CS]: false, [AV]: true },
    },
  ];
  for (const [i, c] of cases.entries()) {
    const dir = path.join(root, `record-${i + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    log(`lipsync-proof: rendering "${c.name}"…`);
    run(dir, [
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=320x180:r=60:d=${DURATION},format=gray`,
      "-vf",
      `geq=lum='20+215*${lit(PC, String(ROOM.screen), "60")}',format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      FILES.screen,
    ]);
    const lat = `(${ROOM.cameraSeesPhone + c.camera}+${c.cameraDriftPerSec ?? 0}*T)`;
    run(dir, [
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=320x180:r=${CAM_FPS}:d=${DURATION},format=gray`,
      // The phone fills the middle quarter of the camera's view; the room is dim.
      "-vf",
      `geq=lum='if(between(X,80,239)*between(Y,45,134),20+200*${lit(PHONE, lat, CAM_FPS)},30)',format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      FILES.camera,
    ]);
    run(dir, [
      "-f",
      "lavfi",
      "-i",
      `aevalsrc='${micExpr(c.audio, c.audioDriftPerSec)}':s=48000:d=${DURATION}`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      FILES.mic,
    ]);
    const meta: Meta = {
      mode: "record",
      t0Ms: origin,
      startedWallMs: origin,
      cameraMarker: "phone",
      logicalCpus: 32,
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, "events.jsonl"), events + "\n");
    const r = analyze(dir, bdir);
    const good = Object.entries(c.expect).every(
      ([k, want]) => passed(r.verdicts[k]) === want
    );
    ok &&= good;
    results.push(
      `| ${c.name} | ${r.sync.audioMinusCamera.medianMs} ms (n=${r.sync.audioMinusCamera.n}) | ${r.verdicts[LIP]} | ${r.verdicts[CS]} | ${r.verdicts[AV]} | ${r.verdicts[VS_OBS]} | ${Object.entries(
        c.expect
      )
        .map(([k, v]) => `${SHORT[k]} ${v ? "PASS" : "FAIL"}`)
        .join(", ")} | ${good ? "yes" : "NO"} |`
    );
  }
  const summary = [
    "# Lip sync without a clap: the phone marker (synthetic proof)",
    "",
    `Room: screen capture +${ROOM.screen * 1000} ms, camera sees the phone +${ROOM.cameraSeesPhone * 1000} ms (the phone fills a quarter of the view), PC speakers +${ROOM.speakers * 1000} ms, the phone's own beep ${ROOM.phoneAV * 1000} ms after its flash (beeps at -26 dBFS in noise; the PC beep has a 2 kHz harmonic at 30%). PC markers every ${PC.period} s, phone markers every ${PHONE.period} s, for ${DURATION} s.`,
    "",
    ...results,
    "",
    '"vs OBS" reads the injected error plus up to one OBS canvas frame (16.7 ms): the OBS file shows the camera only at 60 fps canvas ticks. The verdict allows that frame. The phone\'s own 137 ms is in both runs and cancels.',
    "",
    ok ? "LIPSYNC PROOF PASS" : "LIPSYNC PROOF FAIL",
  ].join("\n");
  fs.writeFileSync(path.join(root, "summary.md"), summary + "\n");
  console.log(summary);
  log(`lipsync-proof: ${root}`);
  return ok;
}
