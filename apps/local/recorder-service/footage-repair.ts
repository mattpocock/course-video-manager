import fs from "node:fs";
import path from "node:path";
import { runToEnd, type Launcher } from "./launcher";
import type { FileRepair, RecordingSessionFiles } from "./protocol";

/**
 * MAKING A RECORDING SESSION'S FILES READABLE. An MKV that ffmpeg never
 * finished (the process was killed, the power went) has every cluster it
 * flushed but no duration, which CVM reads (format=duration) and gets NaN
 * for. A stream-copy remux writes it again with one, losing nothing. The
 * file as ffmpeg left it is kept beside it as `<name>.raw.mkv`.
 */

/** The file's duration in seconds, as ffmpeg reads it; null when it has none. */
export const readDuration = async (
  launch: Launcher,
  file: string
): Promise<number | null> => {
  const { stderr } = await runToEnd(
    launch({
      tool: "ffmpeg",
      args: ["-hide_banner", "-i", path.basename(file)],
      cwd: path.dirname(file),
    })
  );
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return seconds > 0 ? seconds : null;
};

export type RepairedFile = { repair: FileRepair; duration: number | null };

/**
 * Remuxes the file in place when it has no duration. Never throws: a file
 * that cannot be repaired (its drive gone, still held open) is `failed`.
 */
export const repairFile = async (
  launch: Launcher,
  file: string
): Promise<RepairedFile> => {
  try {
    return await repair(launch, file);
  } catch (e) {
    console.error(`recorder: could not repair ${file}`, e);
    return { repair: "failed", duration: null };
  }
};

const repair = async (
  launch: Launcher,
  file: string
): Promise<RepairedFile> => {
  if (!fs.existsSync(file)) return { repair: "missing", duration: null };
  const duration = await readDuration(launch, file);
  if (duration !== null) return { repair: "readable", duration };

  const raw = file.replace(/\.mkv$/, ".raw.mkv");
  fs.renameSync(file, raw);
  const { code } = await runToEnd(
    launch({
      tool: "ffmpeg",
      args: [
        "-hide_banner",
        "-v",
        "error",
        "-y",
        "-i",
        path.basename(raw),
        "-map",
        "0",
        "-c",
        "copy",
        path.basename(file),
      ],
      cwd: path.dirname(file),
    })
  );
  const repaired = code === 0 ? await readDuration(launch, file) : null;
  if (repaired === null) {
    // Leave the file where CVM looks for it, as it was.
    fs.rmSync(file, { force: true });
    fs.renameSync(raw, file);
    return { repair: "failed", duration: null };
  }
  return { repair: "remuxed", duration: repaired };
};

/** Every file of a Recording Session, repaired where it needs it. */
export const repairFiles = async (
  launch: Launcher,
  files: RecordingSessionFiles
) => {
  const camera = await repairFile(launch, files.camera);
  const screen = await repairFile(launch, files.screen);
  const mic = await repairFile(launch, files.mic);
  return { camera, screen, mic };
};
