import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCREEN_TO_NV12 } from "./colour";
import { FFMPEG_BUILD } from "./windows-devices";

const FFMPEG_DIR = path.join(import.meta.dirname, "../ffmpeg");
const buildSh = fs.readFileSync(path.join(FFMPEG_DIR, "build.sh"), "utf8");
const pinned = (name: string) =>
  new RegExp(`^${name}=(\\S+)`, "m").exec(buildSh)?.[1];

describe("CVM's ffmpeg build", () => {
  it("builds the version the service insists on", () => {
    expect(`${pinned("FFMPEG_VERSION")}-${pinned("CVM_BUILD")}`).toBe(
      FFMPEG_BUILD
    );
  });

  it("patches in every scale_d3d11 option the screen chain uses", () => {
    const patch = fs
      .readdirSync(path.join(FFMPEG_DIR, "patches"))
      .map((f) => fs.readFileSync(path.join(FFMPEG_DIR, "patches", f), "utf8"))
      .join("\n");
    const used = /scale_d3d11=([^,]+)/.exec(SCREEN_TO_NV12)![1]!.split(":");
    for (const option of used.map((o) => o.split("=")[0])) {
      if (option === "format") continue; // stock
      expect(patch).toContain(`+    { "${option}",`);
    }
  });

  it("refuses to build without the Live Stream composite's components", () => {
    const inside = fs.readFileSync(path.join(FFMPEG_DIR, "inside.sh"), "utf8");
    const required = /^REQUIRED="([^"]*)"/m.exec(inside)![1]!.split(/\s+/);
    expect(required).toEqual(
      expect.arrayContaining([
        "OVERLAY_CUDA_FILTER",
        "STREAMSELECT_FILTER",
        "RTMP_PROTOCOL",
        "RTMPS_PROTOCOL",
        "H264_CUVID_DECODER",
      ])
    );
  });

  it("is GPL-3.0-or-later and never nonfree, as ffmpeg/NOTICE says", () => {
    const inside = fs.readFileSync(path.join(FFMPEG_DIR, "inside.sh"), "utf8");
    expect(inside).toContain("--enable-gpl");
    expect(inside).toContain("--enable-version3");
    expect(inside).not.toContain("--enable-nonfree");
    expect(inside).not.toContain("--enable-cuda-nvcc");
    expect(fs.readFileSync(path.join(FFMPEG_DIR, "NOTICE"), "utf8")).toContain(
      "GPL-3.0-or-later"
    );
  });
});
