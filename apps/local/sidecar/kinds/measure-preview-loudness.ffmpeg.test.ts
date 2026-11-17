import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SidecarContextTest,
  type SidecarContext,
} from "@/services/sidecar-context";
import { previewGainsForClips } from "@/services/preview-gains.server";
import type { JobContext } from "../job-kind";
import { measurePreviewLoudnessJobKind } from "./measure-preview-loudness";

/**
 * The `measure-preview-loudness` Job with the real ffmpeg, over tiny lavfi
 * files on a temp Storage Root (no device), read back the way the editor's
 * loader reads it. Skipped where there is no ffmpeg.
 *
 * Each sound is a 1 kHz sine whose integrated loudness is known without
 * measuring it: EBU Tech 3341 puts a mono 1 kHz sine at 0 dBFS at −3.01
 * LUFS, so amplitude 10^((L + 3.01) / 20) reads L LUFS.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const sineAt = (lufs: number) =>
  `aevalsrc=${Math.pow(10, (lufs + 3.01) / 20).toFixed(5)}*sin(2*PI*1000*t):s=48000:d=4`;

describe.skipIf(!hasFfmpeg)("the measure-preview-loudness Job", () => {
  const root = path.join(
    os.tmpdir(),
    `preview-loudness-${process.pid}-${Date.now()}`
  );
  const at = (relative: string) => path.join(root, relative);
  const ffmpeg = (out: string, ...args: string[]) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync("ffmpeg", ["-hide_banner", "-v", "error", ...args, out]);
  };

  beforeAll(() => {
    // A CVM-recorder mic, recorded quiet.
    ffmpeg(at("raw-footage/s1/mic.mka"), "-f", "lavfi", "-i", sineAt(-34));
    // An OBS take, a little under the export.
    ffmpeg(at("raw-footage/take.mkv"), "-f", "lavfi", "-i", sineAt(-22));
    // An interview mixed elsewhere, louder than the export.
    ffmpeg(
      at("raw-footage/imported/interview.mp4"),
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x36:d=4",
      "-f",
      "lavfi",
      "-i",
      sineAt(-12),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest"
    );
    // A screen recording with no sound at all.
    ffmpeg(
      at("raw-footage/silent.mkv"),
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x36:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p"
    );
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const ctx: JobContext = {
    jobId: "job-1",
    attempt: 1,
    maxAttempts: 1,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: () => Effect.void,
  };

  const provided = <A, E>(
    effect: Effect.Effect<A, E, NodeContext.NodeContext | SidecarContext>
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(Layer.mergeAll(NodeContext.layer, SidecarContextTest)),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([["STORAGE_ROOTS", root]]))
        )
      )
    );

  const clip = (id: string, videoFilename: string) => ({
    id,
    videoFilename,
    sourceStartTime: 0,
    sourceEndTime: 1,
  });

  it("measures every file once, and the editor's preview gains follow", async () => {
    const files = [
      "raw-footage/s1/mic.mka",
      "raw-footage/take.mkv",
      "raw-footage/imported/interview.mp4",
      "raw-footage/silent.mkv",
    ];
    await provided(
      measurePreviewLoudnessJobKind.runRaw({ files: files.map(at) }, ctx)
    );

    const measured = files.map(
      (file) =>
        JSON.parse(fs.readFileSync(`${at(file)}.loudness.json`, "utf8"))
          .integratedLufs as number | null
    );
    expect(measured[0]).toBeCloseTo(-34, 0);
    expect(measured[1]).toBeCloseTo(-22, 0);
    expect(measured[2]).toBeCloseTo(-12, 0);
    expect(measured[3]).toBeNull();

    const gains = await provided(
      previewGainsForClips(
        [
          clip("quiet-mic", files[0]!),
          clip("obs", files[1]!),
          clip("imported", files[2]!),
        ],
        [root]
      )
    );
    expect(gains.toMeasure).toEqual([]);
    expect(gains.gainDbByClipId["quiet-mic"]).toBe(12);
    expect(gains.gainDbByClipId["obs"]).toBeCloseTo(6, 0);
    expect(gains.gainDbByClipId["imported"]).toBe(0);
  });
});
