import { describe, expect, it } from "vitest";
import { computeExportHash, toExportClips } from "@/services/export-hash";

/**
 * The Export Hash names a Footage file by its path RELATIVE to its Storage
 * Root (#2104), so moving the file between drives, or the data migration
 * rewriting its row, never changes an address.
 */
const ROOTS = ["/mnt/d", "/mnt/e"];

const obs = (videoFilename: string, sourceStartTime = 1.5) => ({
  videoFilename,
  sourceStartTime,
  sourceEndTime: 9.25,
  recordingSessionId: null,
  sceneOverride: null,
  recordingSession: null,
  pauseType: "long",
  zoomType: "none",
  overlays: [
    {
      at: 2,
      durationInSeconds: 3,
      kind: "definition-card",
      disableEnterAnimation: false,
      disableExitAnimation: false,
      title: "Term",
      description: "Meaning",
      bullets: null,
      footagePath: null,
      footageStart: null,
      chatSpin: null,
    },
  ],
});

const hash = (rows: Parameters<typeof toExportClips>[0], roots = ROOTS) =>
  computeExportHash(toExportClips(rows), "landscape", roots);

describe("the Export Hash on root-relative Footage paths", () => {
  it("hashes a legacy absolute path and its relative form identically", () => {
    expect(hash([obs("/mnt/d/raw-footage/take.mkv")])).toBe(
      hash([obs("raw-footage/take.mkv")])
    );
  });

  it("does not depend on which root holds the file", () => {
    expect(hash([obs("/mnt/e/raw-footage/take.mkv")])).toBe(
      hash([obs("/mnt/d/raw-footage/take.mkv")])
    );
  });

  it("changes nothing else: the relative path takes the old absolute path's place in the payload", () => {
    // What the old hash computed for a row whose path happened to read
    // `raw-footage/take.mkv` — every other input (timings, pause, overlays,
    // format, version) contributes exactly what it did.
    expect(hash([obs("/mnt/d/raw-footage/take.mkv")])).toBe(
      hash([obs("raw-footage/take.mkv")], [])
    );
    // Pinned to sha256 of the payload written out by hand —
    // {"v":1,"fmt":"landscape","clips":[{"f":"raw-footage/take.mkv","s":1.5,
    // "e":9.25,"p":"long","o":[{"a":2,"d":3,"t":"Term","x":"Meaning"}]}]} —
    // so a change to the normalization cannot slip through.
    expect(hash([obs("/mnt/d/raw-footage/take.mkv")])).toBe(
      "43696cac2344cbc564727d017c5ebe8a"
    );
    // Other inputs still move the address.
    expect(hash([obs("raw-footage/take.mkv", 2)])).not.toBe(
      hash([obs("raw-footage/take.mkv")])
    );
  });

  it("hashes a path under no root exactly as before", () => {
    // A CVM-recorder take in ~/Videos (#2105 moves those).
    expect(hash([obs("/home/matt/Videos/s1/mic.mkv")])).toBe(
      hash([obs("/home/matt/Videos/s1/mic.mkv")], [])
    );
    // `/mnt/dd` is not under `/mnt/d`.
    expect(hash([obs("/mnt/dd/raw-footage/take.mkv")])).toBe(
      hash([obs("/mnt/dd/raw-footage/take.mkv")], [])
    );
  });

  it("normalizes a CVM-recorder Clip's mic under a root too", () => {
    const session = (dir: string) => ({
      ...obs(`${dir}/mic.mkv`),
      overlays: [],
      recordingSessionId: "s1",
      recordingSession: {
        id: "s1",
        cameraFilePath: `${dir}/camera.mkv`,
        screenFilePath: `${dir}/screen.mkv`,
        micFilePath: `${dir}/mic.mkv`,
        micOffsetMs: 150,
        micEq: null,
        format: "landscape" as const,
        screenCaptured: true,
        sceneEvents: [{ fileTime: 0, scene: "Camera" as const }],
      },
    });
    expect(hash([session("/mnt/d/raw-footage/s1")])).toBe(
      hash([session("/mnt/e/raw-footage/s1")])
    );
    expect(hash([session("/mnt/d/raw-footage/s1")])).toBe(
      hash([session("raw-footage/s1")])
    );
  });
});
