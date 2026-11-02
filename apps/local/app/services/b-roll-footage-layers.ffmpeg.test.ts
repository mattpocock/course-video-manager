import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  clipComposite,
  clipLayers,
  clipSource,
  footageLayers,
} from "@/packages/clip-source";
import { footageLayerTimeAt } from "@/features/video-editor/footage-layers-preview";
import {
  hasFfmpeg,
  lavfi,
  probe,
  exportClips,
  sessionRow,
  exportClip,
  centreLumas,
  flashes,
  beeps,
} from "@/test-utils/video-export-ffmpeg";

/**
 * A B-roll as migration 0049 leaves it (#2576): one full-frame, muted Footage
 * Layer on each Clip its window covered, with its `from` carried on. Here a
 * B-roll from 0.5 s into the 30 fps Imported Footage Clip, across the join,
 * to 0.25 s into the next Clip, so every Clip's flash and beep stay in view.
 * Its Footage is 30 fps, each frame a grey of its own, and its `from` (0.21)
 * is off that frame grid. The export must show, on every frame, the Footage
 * frame the editor's preview shows (`footageLayerTimeAt`), and keep the CFR
 * 60 joins and every beep on its flash.
 */
describe.skipIf(!hasFfmpeg)(
  "a B-roll migrated to Footage Layers, across a join",
  () => {
    const dir = path.join(
      os.tmpdir(),
      `b-roll-layers-${process.pid}-${Date.now()}`
    );
    const CLIP = 1.8137;
    const FRAMES = 109;
    const FROM = 0.21;
    const brollRow = (at: number, start: number, duration: number) => ({
      position: 1,
      kind: "footage" as const,
      footagePath: path.join(dir, "b-roll.mkv"),
      footageStart: start,
      sessionFile: null,
      cropX: 0,
      cropY: 0,
      cropW: 1,
      cropH: 1,
      placeX: 0,
      placeY: 0,
      placeW: 1920,
      placeH: 1080,
      volume: 0,
      spanAt: at,
      spanDuration: duration,
    });
    const scene = {
      ...brollRow(0, 0, 1),
      kind: "scene" as const,
      volume: 1,
      footagePath: null,
      footageStart: null,
      cropX: null,
      cropY: null,
      cropW: null,
      cropH: null,
      placeX: null,
      placeY: null,
      placeW: null,
      placeH: null,
      spanAt: null,
      spanDuration: null,
    };
    // The window opens 0.5 s into the imported Clip and runs to its end
    // (CLIP - 0.5 s), then on 0.25 s into the next, whose `from` is carried
    // on by the CLIP - 0.5 s already shown.
    const importedLayers = [scene, brollRow(0.5, FROM, CLIP - 0.5)];
    const nextLayers = [scene, brollRow(0, FROM + CLIP - 0.5, 0.25)];
    const imported = () => {
      const start = 2.2;
      const source = clipSource({
        videoFilename: path.join(dir, "interview.mp4"),
        sourceStartTime: start,
        sourceEndTime: start + CLIP,
        recordingSessionId: null,
        sceneOverride: null,
        recordingSession: null,
        layers: importedLayers,
      });
      return {
        inputVideo: path.join(dir, "interview.mp4"),
        startTime: start,
        duration: CLIP,
        pauseType: "none" as const,
        zoomType: "none",
        composite: clipComposite(source),
        layers: clipLayers(source),
      };
    };
    const clips = [
      exportClip(sessionRow(dir, 0.2, 0.2 + CLIP, [])),
      imported(),
      exportClip({
        ...sessionRow(dir, 4.2, 4.2 + CLIP, []),
        layers: nextLayers,
      }),
      exportClip(sessionRow(dir, 6.2, 6.2 + CLIP, [])),
    ];
    let output: string;

    beforeAll(async () => {
      fs.mkdirSync(dir, { recursive: true });
      const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
      lavfi(
        dir,
        "screen.mkv",
        "color=c=black:s=320x180:r=60:d=9,drawbox=c=white:t=fill:enable='between(mod(t\\,2)\\,0.499\\,0.509)'",
        h264
      );
      lavfi(dir, "camera.mkv", "color=c=lime:s=384x216:r=30000/1001:d=9", h264);
      lavfi(
        dir,
        "mic.mkv",
        "aevalsrc='if(between(mod(t\\,2)\\,0.35\\,0.40)\\,0.5*sin(2*PI*1000*t)\\,0)+0.003*sin(2*PI*200*t)':s=48000:d=9",
        ["-c:a", "pcm_s16le", "-ac", "1"]
      );
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=30:d=9,drawbox=c=white:t=fill:enable='between(mod(t\\,2)\\,0.499\\,0.52)'",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc='if(between(mod(t\\,2)\\,0.5\\,0.55)\\,0.5*sin(2*PI*1000*t)\\,0)+0.003*sin(2*PI*200*t)':s=48000:d=9",
        ...h264,
        "-c:a",
        "pcm_s16le",
        "-f",
        "matroska",
        path.join(dir, "interview.mp4"),
      ]);
      // Greys no flash detector mistakes for white (at most 106).
      lavfi(
        dir,
        "b-roll.mkv",
        "nullsrc=s=320x180:r=30:d=4,geq=lum='16+mod(N\\,10)*10':cb=128:cr=128,format=yuv420p",
        ["-c:v", "ffv1"]
      );
      output = (await exportClips(dir, clips)).output;
    }, 120_000);

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("shows the B-roll's Footage on the frames the preview shows, in both Clips", () => {
      const lumas = centreLumas(output).map(([, luma]) => luma);
      const checked = [
        // The imported Clip, from its window's start to its last frame.
        { clip: 1, layers: importedLayers, from: 30, to: FRAMES - 1 },
        // The next Clip, to just before its window's end.
        { clip: 2, layers: nextLayers, from: 0, to: 14 },
      ];
      for (const { clip, layers, from, to } of checked) {
        const [layer] = footageLayers(
          clipLayers(
            clipSource({
              videoFilename: "x",
              sourceStartTime: 0,
              sourceEndTime: 1,
              layers,
            })
          )
        );
        for (let frame = from; frame <= to; frame++) {
          // The preview halfway through the export's frame.
          const footageFrame = Math.floor(
            footageLayerTimeAt(layer!, (frame + 0.5) / 60) * 30 + 1e-9
          );
          const shown = lumas[clip * FRAMES + frame]!;
          const grey = 16 + (footageFrame % 10) * 10;
          expect([clip, frame, Math.abs(shown - grey) <= 4]).toEqual([
            clip,
            frame,
            true,
          ]);
        }
      }
      // Not a frame before the window, nor at its end: the black below.
      expect(lumas[FRAMES + 29]).toBeLessThan(20);
      expect(lumas[2 * FRAMES + 15]).toBeLessThan(20);
    });

    it("is CFR 60, with every beep still on its flash", () => {
      const video = probe(output).streams.find(
        (s) => s.codec_type === "video"
      )!;
      expect(video).toMatchObject({
        r_frame_rate: "60/1",
        avg_frame_rate: "60/1",
        nb_frames: String(clips.length * FRAMES),
      });
      const flashTimes = flashes(output).filter(
        (t, i, all) => i === 0 || t - all[i - 1]! > 0.05
      );
      expect(flashTimes).toHaveLength(clips.length);
      const beepTimes = beeps(output).slice(0, 3);
      expect(beepTimes).toHaveLength(3);
      beepTimes.forEach((t, k) =>
        expect(Math.abs(t - flashTimes[k]!)).toBeLessThan(1 / 30)
      );
    });
  }
);
