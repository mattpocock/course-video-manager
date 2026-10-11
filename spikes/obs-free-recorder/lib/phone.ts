// The phone's marker video, and the LAN download for it.
//
// The camera can't see the DELL, so a phone propped in front of the camera
// plays this video for the whole test: black, with a full-screen white flash
// and a 2 kHz beep together every 10 s. The flash starts on frame 300·k and the
// beep on audio sample 480000·k, so they are sample-aligned in the file. The
// phone's own A/V offset (its display against its speaker) is unknown, but it
// is the same in every run, so it cancels in "lip sync vs OBS" and in every
// drift (lib/sync.ts).
//
// 2.5 h long so it never loops during the ~1.5 h test. Built once and cached
// under <out>/phone/ (the name carries a hash of the settings below).
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ffmpeg } from "./ff.ts";
import {
  findOnsets,
  PHONE_BEEP_HZ,
  TONE,
  TONE_BIAS_SEC,
  toneSeries,
} from "./sync.ts";
import { qrTerminal } from "./qr.ts";
import { SYSTEM32, toWindowsPath } from "./win.ts";

/** Google Pixel 7a: 1080x2400 portrait. H.264 High + AAC in MP4 plays in Files by Google. */
export const PHONE_VIDEO = {
  w: 1080,
  h: 2400,
  fps: 30,
  periodSec: 10,
  flashSec: 0.2,
  beepHz: PHONE_BEEP_HZ,
  /** 100 ms, 1 ms rise, 5 ms fall: short and unlike the PC's 250 ms 1 kHz beep, which the detector uses to tell them apart. */
  beepSec: 0.1,
  beepAmp: 0.5,
  durationSec: 2.5 * 3600,
  sampleRate: 48000,
};

const HASH = crypto
  .createHash("sha1")
  .update(JSON.stringify(PHONE_VIDEO))
  .digest("hex")
  .slice(0, 8);
export const PHONE_FILE = `rig-phone-${HASH}.mp4`;

export const phoneVideoPath = (out: string) =>
  path.join(out, "phone", PHONE_FILE);

type Point = {
  at: number;
  flash: number | null;
  beep: number | null;
  offsetMs: number | null;
};

/**
 * Builds the video if it isn't cached, then checks it: at the start, middle
 * and end, the first white frame must be at 10·k s and the beep's onset at the
 * same time (±1.5 ms), as ffmpeg decodes the file.
 */
export function ensurePhoneVideo(out: string, log: (...a: unknown[]) => void) {
  const file = phoneVideoPath(out);
  const okFile = `${file}.check.json`;
  if (fs.existsSync(file) && fs.existsSync(okFile)) {
    const check = JSON.parse(fs.readFileSync(okFile, "utf8")) as {
      ok: boolean;
    };
    if (check.ok) return { file, cached: true, check };
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const P = PHONE_VIDEO;
  const cycles = Math.ceil(P.durationSec / P.periodSec);
  log(
    `phone video: building ${PHONE_FILE} (${P.w}x${P.h}, ${P.durationSec / 3600} h; about 20 s)…`
  );
  const run = (args: string[]) => {
    const r = ffmpeg(["-y", "-v", "error", ...args], dir);
    if (r.stderr.trim())
      throw new Error(
        `ffmpeg: ${r.stderr.trim().split("\n").slice(-3).join(" | ")}`
      );
  };
  const tmp = `tmp-${process.pid}`;
  // One 10 s cycle each: video (300 frames, the first 6 white, one keyframe
  // per cycle) and audio (PCM, exactly 480000 samples, so looping it is
  // sample-exact). The 2.5 h file loops both and encodes the AAC once.
  run([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${P.w}x${P.h}:r=${P.fps}:d=${P.periodSec},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(t,${P.flashSec})',format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-tune",
    "stillimage",
    "-g",
    String(P.fps * P.periodSec),
    "-keyint_min",
    String(P.fps * P.periodSec),
    "-sc_threshold",
    "0",
    "-bf",
    "0",
    "-profile:v",
    "high",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-an",
    `${tmp}-cycle.mp4`,
  ]);
  const b = P.beepSec;
  run([
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${P.beepAmp}*sin(2*PI*${P.beepHz}*t)*if(lt(t,0.001),t/0.001,if(lt(t,${b - 0.005}),1,if(lt(t,${b}),(${b}-t)/0.005,0)))':s=${P.sampleRate}:d=${P.periodSec}:c=mono`,
    "-c:a",
    "pcm_s16le",
    `${tmp}-cycle.wav`,
  ]);
  run([
    "-stream_loop",
    String(cycles - 1),
    "-i",
    `${tmp}-cycle.mp4`,
    "-stream_loop",
    String(cycles - 1),
    "-i",
    `${tmp}-cycle.wav`,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-t",
    String(P.durationSec),
    "-movflags",
    "+faststart",
    `${tmp}.mp4`,
  ]);
  for (const f of [`${tmp}-cycle.mp4`, `${tmp}-cycle.wav`])
    fs.rmSync(path.join(dir, f), { force: true });
  const check = verifyPhoneVideo(path.join(dir, `${tmp}.mp4`));
  if (!check.ok) {
    fs.rmSync(path.join(dir, `${tmp}.mp4`), { force: true });
    throw new Error(
      `phone video: flash and beep not aligned: ${JSON.stringify(check.points)}`
    );
  }
  fs.renameSync(path.join(dir, `${tmp}.mp4`), file);
  fs.writeFileSync(okFile, JSON.stringify(check, null, 1));
  log(
    `phone video: ${file} (${Math.round(fs.statSync(file).size / 1e6)} MB), flash and beep aligned: ${check.points.map((p) => `${p.offsetMs} ms at ${p.at} s`).join(", ")}`
  );
  return { file, cached: false, check };
}

/** First white frame and the 2 kHz onset around marker times near the start, middle and end. */
export function verifyPhoneVideo(file: string) {
  const P = PHONE_VIDEO;
  const last = Math.floor((P.durationSec - 5) / P.periodSec) * P.periodSec;
  const ats = [
    P.periodSec,
    Math.round(P.durationSec / 2 / P.periodSec) * P.periodSec,
    last,
  ];
  const points: Point[] = ats.map((at) => {
    const v = ffmpeg(
      [
        "-copyts",
        "-ss",
        String(at - 1),
        "-t",
        "2",
        "-i",
        path.basename(file),
        "-vf",
        "scale=16:9,showinfo",
        "-an",
        "-f",
        "null",
        "-",
      ],
      path.dirname(file)
    ).stderr;
    let flash: number | null = null;
    for (const m of v.matchAll(/pts_time:\s*([\d.]+).*?mean:\[(\d+)/g))
      if (Number(m[2]) > 128) {
        flash = Number(m[1]);
        break;
      }
    // Audio: decoded from the top (output-side -ss) so the seek is sample-exact.
    const a = ffmpeg(
      [
        "-i",
        path.basename(file),
        "-ss",
        String(at - 1),
        "-t",
        "2",
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
    ).stdout;
    const x = new Float64Array(a.length >> 1);
    for (let i = 0; i < x.length; i++) x[i] = a.readInt16LE(i * 2) / 32768;
    const on = findOnsets(toneSeries(x, P.beepHz, at - 1), {
      minRise: 0.05,
      minDurSec: 0.05,
      maxDurSec: 0.18,
    }).onsets[0];
    const beep = on ? on.t - TONE_BIAS_SEC : null;
    return {
      at,
      flash,
      beep: beep === null ? null : Math.round(beep * 1e4) / 1e4,
      offsetMs:
        flash === null || beep === null
          ? null
          : Math.round((beep - flash) * 1e4) / 10,
    };
  });
  return {
    ok: points.every(
      (p) =>
        p.flash !== null &&
        Math.abs(p.flash - p.at) < 0.001 &&
        p.offsetMs !== null &&
        Math.abs(p.offsetMs) <= 1.5
    ),
    points,
    settings: P,
  };
}

/**
 * Serves the video to the phone over the LAN from Windows (lib/phone-serve.ps1):
 * WSL is in NAT mode here, so a phone can't reach a server inside WSL. Resolves
 * with the URL once it listens; it stops when `stopFile` appears, the rig exits,
 * or after `maxMinutes`.
 */
export function servePhoneVideo(o: {
  file: string;
  port: number;
  stopFile: string;
  maxMinutes: number;
  bind?: string;
  onLine?: (line: string) => void;
}): Promise<{ url: string; child: ChildProcess }> {
  fs.rmSync(o.stopFile, { force: true });
  const child = spawn(
    `${SYSTEM32}/WindowsPowerShell/v1.0/powershell.exe`,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      toWindowsPath(path.join(import.meta.dirname, "phone-serve.ps1")),
      "-File",
      toWindowsPath(o.file),
      "-Port",
      String(o.port),
      "-StopFile",
      toWindowsPath(o.stopFile),
      "-MaxMinutes",
      String(o.maxMinutes),
      ...(o.bind ? ["-Bind", o.bind] : []),
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "pipe"] }
  );
  process.once("exit", () => {
    try {
      fs.writeFileSync(o.stopFile, "");
    } catch {}
  });
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        o.onLine?.(line);
        const m = line.match(/^URL (\S+)/);
        if (m) resolve({ url: m[1]!, child });
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) =>
      reject(new Error(`phone-serve.ps1 exited (${code}) before it listened`))
    );
  });
}

/**
 * ./rig phone: builds (or finds) the phone's marker video and prints its path.
 * --serve also serves it on the LAN from Windows until <out>/phone/serve.stop
 * appears, Ctrl-C, or 90 min, printing the URL and a QR code for it.
 */
export async function phoneCommand(
  o: {
    out: string;
    serve: boolean;
    bind?: string;
    urlFile?: string;
    port: number;
  },
  log: (...a: unknown[]) => void
) {
  const { file } = ensurePhoneVideo(o.out, log);
  if (!o.serve) {
    console.log(file);
    return;
  }
  const stopFile = path.join(o.out, "phone", "serve.stop");
  const stop = () => {
    fs.writeFileSync(stopFile, "");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const { url, child } = await servePhoneVideo({
    file,
    port: o.port,
    stopFile,
    maxMinutes: 90,
    bind: o.bind,
    onLine: (l) => log(`phone-serve: ${l}`),
  });
  if (o.urlFile) fs.writeFileSync(o.urlFile, `${url}\n`);
  log(`phone video: ${url}`);
  console.log(qrTerminal(url));
  await new Promise((r) => child.once("exit", r));
}
