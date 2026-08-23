import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildOverlayCompositeFilterGraph } from "@/services/overlay-compositing";

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
