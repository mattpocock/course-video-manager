import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SCREEN_TO_NV12 } from "./colour";

/**
 * screen.mkv's colour against OBS's, with the real ffmpeg (no GPU): the
 * CPU half of `SCREEN_TO_NV12` (from its read-back on) runs on what
 * scale_d3d11 hands it, BT.709 FULL-range NV12, made here from VS Code's
 * #1e1e1e beside a #3178c6 blue. The file must hold what OBS's does
 * (NV12, 709, Partial): BT.709 limited range, tagged so. Before the fix
 * #1e1e1e was Y=30 in a file tagged limited (RGB 16 on screen); OBS writes
 * Y=42. Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-hide_banner", "-v", "error", ...args]);

/** What scale_d3d11 makes of ddagrab's BGRA: BT.709, full range. */
const D3D11_OUTPUT =
  "color=c=0x1e1e1e:s=128x64:r=60:d=0.1[a];color=c=0x3178c6:s=128x64:r=60:d=0.1[b];" +
  "[a][b]hstack,format=bgra,scale=out_color_matrix=bt709:out_range=pc,format=nv12";

/** Everything `SCREEN_TO_NV12` does after the frame is down from the GPU. */
const cpuHalf = SCREEN_TO_NV12.slice(
  SCREEN_TO_NV12.indexOf("hwdownload,format=nv12,") +
    "hwdownload,format=nv12,".length
);

/** Mean Y, U and V of a 32x32 patch at x, as stored (no conversion). */
const yuvAt = (file: string, x: number) => {
  const out = ffmpeg([
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `crop=32:32:${x}:16,signalstats,metadata=print:file=-`,
    "-f",
    "null",
    "-",
  ]).toString();
  const read = (k: string) =>
    Number(new RegExp(`lavfi\\.signalstats\\.${k}=(\\d+)`).exec(out)![1]);
  return [read("YAVG"), read("UAVG"), read("VAVG")];
};

describe.skipIf(!hasFfmpeg)("screen.mkv's colour, as OBS writes it", () => {
  const dir = hasFfmpeg
    ? mkdtempSync(path.join(tmpdir(), "screen-colour-"))
    : "";
  afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("is BT.709 limited range, tagged so: #1e1e1e is Y=42, as in OBS's files", () => {
    const file = path.join(dir, "screen.mkv");
    ffmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `${D3D11_OUTPUT},${cpuHalf}`,
      "-c:v",
      "libx264",
      "-qp",
      "0",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    const tags = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=pix_fmt,color_range,color_space,color_primaries,color_transfer",
      "-of",
      "csv=p=0",
      file,
    ])
      .toString()
      .trim();
    expect(tags).toBe("yuv420p,tv,bt709,bt709,bt709");
    // VS Code's #1e1e1e: OBS's Y=42 (16 + 219 * 30 / 255), not full range's 30.
    expect(yuvAt(file, 48)).toEqual([42, 128, 128]);
    // #3178c6, BT.709 limited, as OBS converts it.
    expect(yuvAt(file, 176)).toEqual([111, 169, 94]);
  });
});
