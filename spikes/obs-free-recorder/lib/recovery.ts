// kill -9 recovery check, run straight after the rig force-kills the recorders.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FILES } from "./recorder.ts";
import { ffmpeg, lastPacketTime, probe } from "./ff.ts";
import { windowsTool } from "./win.ts";

export type CrashFile = {
  file: string;
  ok: boolean;
  /** Last packet end (s): how much of the take survived. */
  duration: number;
  /** format.duration straight after the kill (null = N/A, which CVM reads as NaN). */
  containerDurationRaw: number | null;
  /** format.duration after the rig's remux repair (equal to raw if none was needed). */
  containerDuration: number | null;
  repairedByRemux: boolean;
  decodeErrors: number;
  killedAtFileTime: number;
  lostSeconds: number;
};

export type CrashResult = {
  killedAtFileTime: number;
  files: CrashFile[];
  pass: boolean;
};

/**
 * Opens each recorded file after a hard kill. It must decode cleanly, stop no
 * more than 2 s before its own process was killed, and carry a container
 * duration, which CVM reads (format=duration) and a killed MKV lacks because
 * the muxer never wrote its trailer. A stream-copy remux writes it, so the rig
 * repairs the file in place and keeps the raw one as *.killed.mkv.
 */
export function checkRecovery(
  runDir: string,
  killedAtFileTime: Record<keyof typeof FILES | string, number>
): CrashResult {
  const containerDuration = (f: string) => {
    const d = Number(probe(path.join(runDir, f))?.format.duration);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null;
  };
  const files = (
    [
      ["screen", FILES.screen],
      ["camera", FILES.camera],
      ["mic", FILES.mic],
    ] as const
  ).map(([role, f]) => {
    const killedAt = killedAtFileTime[role] ?? killedAtFileTime.camera!;
    const raw = containerDuration(f);
    let repaired = false;
    if (raw === null && fs.existsSync(path.join(runDir, f))) {
      const killed = f.replace(/\.mkv$/, ".killed.mkv");
      fs.renameSync(path.join(runDir, f), path.join(runDir, killed));
      const r = spawnSync(
        windowsTool("ffmpeg"),
        [
          "-hide_banner",
          "-v",
          "error",
          "-y",
          "-i",
          killed,
          "-map",
          "0",
          "-c",
          "copy",
          f,
        ],
        { cwd: runDir, encoding: "utf8" }
      );
      repaired = r.status === 0;
      if (!repaired)
        fs.renameSync(path.join(runDir, killed), path.join(runDir, f));
    }
    const fixed = repaired ? containerDuration(f) : raw;
    const duration = lastPacketTime(path.join(runDir, f));
    const { stderr } = ffmpeg(
      ["-v", "error", "-i", f, "-f", "null", "-"],
      runDir
    );
    const decodeErrors = stderr.split("\n").filter((l) => l.trim()).length;
    const lostSeconds = Math.round((killedAt - duration) * 100) / 100;
    return {
      file: f,
      ok: duration > 0 && fixed !== null && Math.abs(fixed - duration) <= 0.5,
      duration: Math.round(duration * 1000) / 1000,
      containerDurationRaw: raw,
      containerDuration: fixed,
      repairedByRemux: repaired,
      decodeErrors,
      killedAtFileTime: Math.round(killedAt * 1000) / 1000,
      lostSeconds,
    };
  });
  return {
    killedAtFileTime: Math.max(...Object.values(killedAtFileTime)),
    files,
    pass: files.every(
      (f) =>
        f.ok &&
        f.lostSeconds <= 2 &&
        f.lostSeconds >= -0.5 &&
        f.decodeErrors === 0
    ),
  };
}
