import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageRoots } from "@/packages/storage";
import { previewGainsForClips } from "./preview-gains.server";
import { footageStamp } from "./footage-cache";
import {
  writePreviewLoudness,
  type PreviewLoudness,
} from "./preview-loudness-cache";

let base: string;
let d: string;
let roots: StorageRoots;

const put = (root: string, relative: string, bytes = "footage") => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return full;
};

const obsClip = (id: string, videoFilename: string) => ({
  id,
  videoFilename,
  sourceStartTime: 0,
  sourceEndTime: 1,
});

const run = <A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const gains = (clips: Parameters<typeof previewGainsForClips>[0]) =>
  run(previewGainsForClips(clips, roots));

/** What the `measure-preview-loudness` Job leaves beside a file it measured. */
const recorded = (file: string, outcome: PreviewLoudness) =>
  run(
    footageStamp(file).pipe(
      Effect.flatMap((stamp) =>
        writePreviewLoudness({ file, stamp: stamp!, outcome, roots })
      )
    )
  );
const measured = (file: string, integratedLufs: number) =>
  recorded(file, { kind: "measured", integratedLufs });

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "preview-gains-"));
  d = path.join(base, "d");
  fs.mkdirSync(d);
  roots = [d];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("previewGainsForClips", () => {
  it("gives unmeasured Imported Footage 0 dB and OBS Footage 12 dB, and asks for both to be measured", async () => {
    const imported = put(d, "raw-footage/imported/interview.mp4");
    const obs = put(d, "raw-footage/take.mkv");

    expect(
      await gains([
        obsClip("a", "raw-footage/imported/interview.mp4"),
        obsClip("b", "raw-footage/take.mkv"),
        obsClip("c", "raw-footage/take.mkv"),
      ])
    ).toEqual({
      gainDbByClipId: { a: 0, b: 12, c: 12 },
      toMeasure: [imported, obs],
    });
  });

  it("lifts a measured file to the export's loudness, and does not measure it again", async () => {
    const obs = put(d, "raw-footage/take.mkv");
    await measured(obs, -22);

    expect(await gains([obsClip("a", "raw-footage/take.mkv")])).toEqual({
      gainDbByClipId: { a: 6 },
      toMeasure: [],
    });
  });

  it("measures a file again once it has changed since it was measured", async () => {
    const imported = put(d, "raw-footage/imported/interview.mp4");
    await measured(imported, -10);
    fs.writeFileSync(imported, "a different, longer file");

    expect(
      await gains([obsClip("a", "raw-footage/imported/interview.mp4")])
    ).toEqual({ gainDbByClipId: { a: 0 }, toMeasure: [imported] });
  });

  it("keeps the fallback for a file that could not be measured, and does not ask again until it changes", async () => {
    const imported = put(d, "raw-footage/imported/broken.mp4");
    const obs = put(d, "raw-footage/broken-take.mkv");
    await recorded(imported, {
      kind: "failed",
      message: "moov atom not found",
    });
    await recorded(obs, { kind: "failed", message: "moov atom not found" });

    expect(
      await gains([
        obsClip("a", "raw-footage/imported/broken.mp4"),
        obsClip("b", "raw-footage/broken-take.mkv"),
      ])
    ).toEqual({ gainDbByClipId: { a: 0, b: 12 }, toMeasure: [] });

    fs.writeFileSync(obs, "the take, repaired");
    expect(
      (await gains([obsClip("b", "raw-footage/broken-take.mkv")])).toMeasure
    ).toEqual([obs]);
  });

  it("measures a CVM-recorder Clip's mic file, the file the preview plays", async () => {
    const session = "raw-footage/sessions/s1";
    put(d, `${session}/camera.mkv`);
    put(d, `${session}/screen.mkv`);
    const mic = put(d, `${session}/mic.mka`);
    await measured(mic, -24);

    expect(
      await gains([
        {
          ...obsClip("a", `${session}/camera.mkv`),
          recordingSessionId: "s1",
          recordingSession: {
            id: "s1",
            cameraFilePath: `${session}/camera.mkv`,
            screenFilePath: `${session}/screen.mkv`,
            micFilePath: `${session}/mic.mka`,
            micOffsetMs: 0,
            format: "landscape",
            screenCaptured: true,
            sceneEvents: [],
          },
        },
      ])
    ).toEqual({ gainDbByClipId: { a: 8 }, toMeasure: [] });
  });

  it("keeps the fallback for a file on no Storage Root, missing from them all or outside raw-footage/, and never asks to measure it", async () => {
    const elsewhere = path.join(base, "Videos", "old-take.mkv");
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    fs.writeFileSync(elsewhere, "footage");

    put(d, "assets/white-noise.mp4");

    expect(
      await gains([
        obsClip("a", elsewhere),
        obsClip("b", "raw-footage/imported/gone.mp4"),
        obsClip("c", "assets/white-noise.mp4"),
      ])
    ).toEqual({ gainDbByClipId: { a: 12, b: 0, c: 12 }, toMeasure: [] });
  });
});
