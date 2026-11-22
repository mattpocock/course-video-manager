import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { readAnimaticClipMockupFiles } from "./animatic-clip-mockup-files.server";
import { pcmToWav } from "./clip-mockup-speech-service";
import { readEnv } from "@/packages/env";

// ===========================================================================
// The Animatic page's file check, against TWO Storage Roots.
//
// It answers from one directory listing per root instead of a stat per file
// (#2337), so these pin that the answer is still the same one the per-file
// check gave: a file on either root is there, one on neither is missing, and
// a row with no voice yet has no WAV.
// ===========================================================================

const LINEAGE = "lineage-1";
const SAMPLE_RATE = 24_000;

/** Half a second of silence, then speech: an onset near 0.5 s. */
const speechWav = () => {
  const samples = new Int16Array(SAMPLE_RATE);
  for (let i = SAMPLE_RATE / 2; i < samples.length; i++) samples[i] = 10_000;
  return pcmToWav(new Uint8Array(samples.buffer), SAMPLE_RATE);
};

let base: string;
let roots: [string, string];
let previousRoots: string | undefined;

const put = (root: string, relativePath: string, content: Uint8Array) => {
  const full = nodePath.join(root, "clip-mockups", LINEAGE, relativePath);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, content);
};

const read = (rows: Parameters<typeof readAnimaticClipMockupFiles>[1]) =>
  Effect.runPromise(
    readAnimaticClipMockupFiles(LINEAGE, rows).pipe(
      Effect.provide(NodeContext.layer)
    )
  );

beforeEach(() => {
  base = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-animatic-files-"));
  roots = [nodePath.join(base, "d"), nodePath.join(base, "e")];
  for (const root of roots) nodeFs.mkdirSync(root);
  previousRoots = readEnv("STORAGE_ROOTS");
  process.env.STORAGE_ROOTS = roots.join(",");
});

afterEach(() => {
  nodeFs.rmSync(base, { recursive: true, force: true });
  if (previousRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = previousRoots;
});

describe("readAnimaticClipMockupFiles", () => {
  it("finds a frame and a WAV on whichever Storage Root has them", async () => {
    put(roots[0], "frame-a.png", new Uint8Array([1]));
    put(roots[1], "speech-a.wav", speechWav());

    const [files] = await read([
      { imagePath: "frame-a.png", audioPath: "speech-a.wav" },
    ]);

    expect(files!.imageMissing).toBe(false);
    expect(files!.audioMissing).toBe(false);
    expect(files!.speechStartSeconds).toBeGreaterThan(0.3);
    expect(files!.speechStartSeconds).toBeLessThan(0.5);
  });

  it("reports a file on neither root as missing", async () => {
    put(roots[0], "frame-a.png", new Uint8Array([1]));

    const files = await read([
      { imagePath: "frame-a.png", audioPath: "speech-gone.wav" },
      { imagePath: "frame-gone.png", audioPath: null },
    ]);

    expect(files).toEqual([
      { imageMissing: false, audioMissing: true, speechStartSeconds: 0 },
      { imageMissing: true, audioMissing: true, speechStartSeconds: 0 },
    ]);
  });

  it("treats a Video with no directory on any root as all missing", async () => {
    const files = await read([{ imagePath: "frame-a.png", audioPath: null }]);

    expect(files).toEqual([
      { imageMissing: true, audioMissing: true, speechStartSeconds: 0 },
    ]);
  });

  it("does not count a path outside the Video's directory as present", async () => {
    nodeFs.mkdirSync(nodePath.join(roots[0], "clip-mockups"), {
      recursive: true,
    });
    nodeFs.writeFileSync(
      nodePath.join(roots[0], "clip-mockups", "outside.png"),
      new Uint8Array([1])
    );
    put(roots[0], "frame-a.png", new Uint8Array([1]));

    const [files] = await read([
      { imagePath: "../outside.png", audioPath: null },
    ]);

    expect(files!.imageMissing).toBe(true);
  });
});
