// `./rig lipsync-proof`: shows that lip sync is still measured with nobody at
// the desk. No clap: the camera points at part of the DELL and the speakers
// play the page's beep, so each marker reaches the camera through the
// monitor's latency and the mic through the speakers'. Those latencies are
// unknown, but they are the same in the OBS baseline and the rig's record run,
// so they cancel in "lip sync vs OBS" (judge.ts lipSyncVsObs), and drift needs
// no absolute value at all.
//
// It renders, with ffmpeg from lavfi only (no device, no capture, no OBS):
//  - an OBS-style baseline: one 1920x1080 60 fps file in the Code layout, the
//    screen flashing at each marker, the face-cam region (only part of it: the
//    DELL as the camera sees it) brightening later at 29.97 fps exposures, and
//    a quiet, noisy 1 kHz beep in the audio;
//  - three rig record runs (screen.mkv, camera.mkv, mic.mkv) with the same
//    room, and an injected rig error: none, audio 60 ms late, audio drifting.
// Then it runs the real analysis on each and checks the verdicts.
import fs from "node:fs";
import path from "node:path";
import { analyze, type Meta } from "./analyze.ts";
import { ffmpeg } from "./ff.ts";
import { passed } from "./judge.ts";
import { FILES } from "./recorder.ts";

const PERIOD = 20; // s between markers
const FIRST = 10; // s, first marker
const DURATION = 200; // s
const FLASH = 0.25; // s
const CAM_FPS = "30000/1001";

// The room: the same physical delays in every run (s after the page draws the flash).
const ROOM = { screen: 0.005, cameraSeesMonitor: 0.025, speakers: 0.03 };

/**
 * Brightness of a frame whose exposure ends at T (fps), as a fraction of that
 * exposure lit by a flash starting `lat` s after each marker: the onset then
 * carries sub-frame timing, as with a real camera.
 */
function lit(lat: number, fpsExpr: string, tExpr = "T") {
  const d = `(1/(${fpsExpr}))`;
  const p = `mod(${tExpr}-${FIRST}-${lat},${PERIOD})`;
  return `if(gte(${tExpr},${FIRST}+${lat}),max(0,min(${p},${FLASH})-max(${p}-${d},0))/${d},0)`;
}

/** A 1 kHz beep `lat` s after each marker (plus `driftPerSec`·t), quiet, in room noise. */
function beep(lat: number, driftPerSec = 0) {
  const at = `(${FIRST}+${lat}+${driftPerSec}*t)`;
  return `0.05*sin(2*PI*1000*t)*gte(t,${at})*lt(mod(t-${at},${PERIOD}),${FLASH})+0.004*(2*random(0)-1)`;
}

type Case = {
  name: string;
  camera: number;
  audio: number;
  audioDriftPerSec?: number;
  expect: Record<string, boolean>;
};

const LIP = "lip sync (audio/camera) drift <= 33 ms";
const VS_OBS =
  "lip sync vs OBS (audio - camera median within 33 ms + 1 OBS frame of the baseline's)";

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
      { length: Math.floor((DURATION - FIRST) / PERIOD) + 1 },
      (_, k) =>
        JSON.stringify({
          type: "flash",
          reason: "scheduled",
          wallMs: origin + (FIRST + k * PERIOD) * 1000,
        })
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
  // of which the DELL fills the top-left quarter. The face cam's frames change
  // at 29.97 fps inside the 60 fps canvas, as in OBS.
  const camT = `floor(T*${CAM_FPS})/(${CAM_FPS})`;
  const camLat = ROOM.cameraSeesMonitor + obs.camera;
  run(bdir, [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=1920x1080:r=60:d=${DURATION}`,
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${beep(ROOM.speakers + obs.audio)}':s=48000:d=${DURATION}`,
    // Each region is drawn at 16x16 (geq is per pixel) and scaled up.
    "-filter_complex",
    `color=c=black:s=16x16:r=60:d=${DURATION},format=gray,geq=lum='20+215*${lit(ROOM.screen, "60")}',scale=1400:1080:flags=neighbor[s];` +
      `color=c=black:s=16x16:r=60:d=${DURATION},format=gray,geq=lum='20+200*${lit(camLat, CAM_FPS, camT)}',scale=245:358:flags=neighbor[c];` +
      `[0:v]drawbox=x=1429:y=364:w=491:h=716:color=0x1e1e1e:t=fill[bg];[bg][s]overlay=0:0[b1];[b1][c]overlay=1429:364,format=yuv420p[v]`,
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
    logicalCpus: 32,
    obsFile: path.join(bdir, "obs.mkv"),
    obsFileStartWallMs: origin,
  };
  fs.writeFileSync(path.join(bdir, "meta.json"), JSON.stringify(bmeta));
  fs.writeFileSync(path.join(bdir, "events.jsonl"), events + "\n");
  const b = analyze(bdir);
  const results: string[] = [
    "| Run | audio - camera median | lip sync drift | lip sync vs OBS | expected | ok |",
    "|---|---|---|---|---|---|",
  ];
  let ok = passed(b.verdicts[LIP]) && b.sync.audioMinusCamera.n >= 8;
  results.push(
    `| OBS baseline (camera +${obs.camera * 1000}, audio +${obs.audio * 1000} ms) | ${b.sync.audioMinusCamera.medianMs} ms (n=${b.sync.audioMinusCamera.n}) | ${b.verdicts[LIP]} | – | drift PASS | ${ok ? "yes" : "NO"} |`
  );

  // ---- three rig runs in the same room ----
  const cases: Case[] = [
    {
      name: "rig: lip sync 10 ms later than OBS",
      camera: 0.07,
      audio: 0.03,
      expect: { [LIP]: true, [VS_OBS]: true },
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
      expect: { [LIP]: false },
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
      `geq=lum='20+215*${lit(ROOM.screen, "60")}',format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      FILES.screen,
    ]);
    run(dir, [
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=320x180:r=${CAM_FPS}:d=${DURATION},format=gray`,
      // The DELL fills the top-left quarter of the camera's view; the room is dim.
      "-vf",
      `geq=lum='if(lt(X,160)*lt(Y,90),20+200*${lit(ROOM.cameraSeesMonitor + c.camera, CAM_FPS)},30)',format=yuv420p`,
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
      `aevalsrc='${beep(ROOM.speakers + c.audio, c.audioDriftPerSec)}':s=48000:d=${DURATION}`,
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
      `| ${c.name} | ${r.sync.audioMinusCamera.medianMs} ms (n=${r.sync.audioMinusCamera.n}) | ${r.verdicts[LIP]} | ${r.verdicts[VS_OBS]} | ${Object.entries(
        c.expect
      )
        .map(
          ([k, v]) => `${k === LIP ? "drift" : "vs OBS"} ${v ? "PASS" : "FAIL"}`
        )
        .join(", ")} | ${good ? "yes" : "NO"} |`
    );
  }
  const summary = [
    "# Lip sync without a clap (synthetic proof)",
    "",
    `Room: screen capture +${ROOM.screen * 1000} ms, camera sees the monitor +${ROOM.cameraSeesMonitor * 1000} ms (DELL fills a quarter of the view), speakers +${ROOM.speakers * 1000} ms (beep at -26 dBFS in noise). Markers every ${PERIOD} s for ${DURATION} s.`,
    "",
    ...results,
    "",
    '"vs OBS" reads the injected error plus up to one OBS canvas frame (16.7 ms): the OBS file shows the camera only at 60 fps canvas ticks. The verdict allows that frame.',
    "",
    ok ? "LIPSYNC PROOF PASS" : "LIPSYNC PROOF FAIL",
  ].join("\n");
  fs.writeFileSync(path.join(root, "summary.md"), summary + "\n");
  console.log(summary);
  log(`lipsync-proof: ${root}`);
  return ok;
}
