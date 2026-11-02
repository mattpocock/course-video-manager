import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildOverlayCompositeFilterGraph } from "@/services/overlay-compositing";
import {
  overlayTransform,
  overlayTransformProgressAt,
  overlayTransformVideoFilter,
  type OverlayTransformWindow,
} from "@/features/videos/overlay-transform";

/**
 * The one test that asks ffmpeg itself whether the compositing pass can run.
 *
 * Every other test of this graph reads the string, or evaluates the camera's
 * expressions with an evaluator of its own. None of them can tell a node ffmpeg
 * accepts from one it refuses, so a `crop` option that a newer ffmpeg had
 * dropped passed every test and failed every export instead — the pass died at
 * `export:composite-overlays` and the Video stayed an Unexported Video.
 *
 * So this test hands the REAL graph to the REAL ffmpeg over synthetic inputs
 * and asks only that it parse and run. It says nothing about the picture; the
 * arithmetic of the move is proved in `overlay-transform.test.ts`.
 *
 * Skipped where there is no ffmpeg. Exporting is a local-only command anyway,
 * so the only machine that can be hurt by this failing is the only machine that
 * can run it.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Runs the graph over one synthetic input per label it reads, for a moment. */
const runGraph = (graph: string, inputCount: number) => {
  const inputs = Array.from({ length: inputCount }, () => [
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=25",
  ]).flat();

  return execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      ...inputs,
      "-filter_complex",
      graph,
      "-map",
      "[outv]",
      "-t",
      "0.2",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
  );
};

describe.skipIf(!hasFfmpeg)(
  "the overlay compositing graph runs in ffmpeg",
  () => {
    it("runs a Bullet Panel, whose Kind carries a camera move", () => {
      const graph = buildOverlayCompositeFilterGraph([
        { startInSeconds: 0.5, endInSeconds: 16.5, kind: "bulletPanel" },
      ]);

      expect(graph).not.toBeNull();
      expect(() => runGraph(graph!, 2)).not.toThrow();
    });

    it("runs a Definition Card, which carries none", () => {
      const graph = buildOverlayCompositeFilterGraph([
        { startInSeconds: 1, endInSeconds: 5, kind: "definitionCard" },
      ]);

      expect(graph).not.toBeNull();
      expect(() => runGraph(graph!, 2)).not.toThrow();
    });

    it("runs several Overlays of both Kinds on one timeline", () => {
      const graph = buildOverlayCompositeFilterGraph([
        { startInSeconds: 0.5, endInSeconds: 16.5, kind: "bulletPanel" },
        { startInSeconds: 20, endInSeconds: 24, kind: "definitionCard" },
        { startInSeconds: 30, endInSeconds: 40, kind: "bulletPanel" },
      ]);

      expect(graph).not.toBeNull();
      expect(() => runGraph(graph!, 4)).not.toThrow();
    });
  }
);

/** The width of the frame a filter chain hands back, according to ffmpeg. */
const probeFilteredWidth = (
  filter: string,
  sourceWidth: number,
  height: number
): number => {
  // ffmpeg writes what it built to STDERR, so this reads the stream it
  // actually prints on rather than an empty stdout.
  const log = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      `color=white:s=${sourceWidth}x${height}:r=25:d=0.04`,
      "-vf",
      filter,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" }
  ).stderr;
  const size = /Output #0[\s\S]*?Stream #0:0[^\n]*?, (\d+)x\d+/.exec(log);
  return size ? Number(size[1]) : sourceWidth;
};

/**
 * Where the camera actually puts the picture, measured in REAL PIXELS out of
 * real ffmpeg.
 *
 * A white source is slid over a near-black background, so the first lit column
 * of a row is the picture's own left edge — which is the whole of what the move
 * does. One row is read per frame; the frame is only 16 tall because nothing
 * about a horizontal slide varies down it.
 */
const measureLeftEdges = (filter: string, fps: number, seconds: number) => {
  const sourceWidth = 1920;
  const height = 16;
  // ASK ffmpeg how wide the frame it hands back is; do not assume the source's
  // own width. `pad` and `crop` each land on a whole, chroma-aligned pixel, so
  // the round trip can return a frame a pixel or two narrower than it was
  // given. Assuming 1920 here read every row at the wrong offset and reported
  // a 406px drift in a move that was within 2px of the preview all along.
  const width = probeFilteredWidth(filter, sourceWidth, height);
  const raw = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=white:s=${sourceWidth}x${height}:r=${fps}:d=${seconds}`,
      "-vf",
      filter,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );

  const frames = Math.floor(raw.length / (width * height));
  return Array.from({ length: frames }, (_, frame) => {
    const row = raw.subarray(
      frame * width * height,
      frame * width * height + width
    );
    const edge = row.findIndex((value) => value > 200);
    return { timeInSeconds: frame / fps, leftEdge: edge };
  });
};

describe.skipIf(!hasFfmpeg)(
  "the camera move, measured in ffmpeg's own pixels",
  () => {
    const window: OverlayTransformWindow & { kind: string } = {
      kind: "bulletPanel",
      startInSeconds: 0,
      endInSeconds: 10,
    };

    /**
     * REGRESSION, and the test that should have existed first.
     *
     * Every other test of this move evaluates its expressions with an evaluator
     * of this repo's own. That proves the arithmetic and says nothing about what
     * ffmpeg does with it — so an export that ran 17px ahead of the panel it was
     * moving with passed the lot. This asks ffmpeg where the picture is.
     *
     * The tolerance is 2px because the source is chroma-subsampled, which pins a
     * crop's `x` to an even column. That is the finest the export can be, not a
     * margin for the move to drift in: the error it was written to catch is ten
     * times it.
     */
    it("puts the picture where the preview says it is, on every frame", () => {
      const filter = overlayTransformVideoFilter(window)!;
      const travel = overlayTransform(window.kind)!.to.offsetX * 1920;

      let worst = 0;
      for (const { timeInSeconds, leftEdge } of measureLeftEdges(
        filter,
        25,
        1
      )) {
        const want = overlayTransformProgressAt(window, timeInSeconds) * travel;
        worst = Math.max(worst, Math.abs(leftEdge - want));
      }

      expect(worst).toBeLessThanOrEqual(2);
    });

    it("leaves the picture alone before the move starts", () => {
      const later = { ...window, startInSeconds: 5, endInSeconds: 9 };
      const filter = overlayTransformVideoFilter(later)!;

      for (const { leftEdge } of measureLeftEdges(filter, 25, 1)) {
        expect(leftEdge).toBe(0);
      }
    });
  }
);
