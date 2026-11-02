import { describe, expect, it } from "vitest";
import { computeExportHash, toExportClips } from "@/services/export-hash";

/**
 * The Export Hash reads a Clip's picture and sound through the Clip Source
 * package. Routing it there must not move a single existing address, or every
 * Video in the library would suddenly need a new export.
 *
 * The literals were computed from these rows on `main` BEFORE the hash went
 * through the Clip Source, so they pin the OBS Clip's contribution byte for
 * byte. They live apart from `export-hash.test.ts`, which is at the repo's
 * per-file size limit.
 */
const OBS = {
  recordingSessionId: null,
  sceneOverride: null,
  recordingSession: null,
};

const obsRows = [
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv",
    sourceStartTime: 12.345,
    sourceEndTime: 19.876,
    ...OBS,
    pauseType: "none",
    zoomType: "none",
    overlays: [],
  },
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv",
    sourceStartTime: 21.5,
    sourceEndTime: 30.25,
    ...OBS,
    pauseType: "long",
    zoomType: "none",
    overlays: [],
  },
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 10-02-41.mkv",
    sourceStartTime: 0.75,
    sourceEndTime: 4.125,
    ...OBS,
    pauseType: "none",
    zoomType: "none",
    overlays: [],
  },
];

describe("an OBS Clip's Export Hash through the Clip Source", () => {
  it("keeps every existing address exactly where it was", () => {
    const clips = toExportClips(obsRows);
    expect(computeExportHash(clips, "landscape", [])).toBe(
      "9a58c78eb23dbfc7020e1c84ae3cc711"
    );
    expect(computeExportHash(clips, "short", [])).toBe(
      "4950ba6b38ec40b7cff9bc03a37d84d1"
    );
  });
});

const sessionRow = (
  micOffsetMs: number,
  micEq: { lowDb: number; midDb: number; highDb: number } | null = null,
  format: "landscape" | "short" = "landscape"
) => ({
  videoFilename: "/rec/s1/mic.mkv",
  sourceStartTime: 12,
  sourceEndTime: 20,
  pauseType: "none",
  zoomType: "none",
  overlays: [],
  recordingSessionId: "session-1",
  sceneOverride: null,
  recordingSession: {
    id: "session-1",
    cameraFilePath: "/rec/s1/camera.mkv",
    screenFilePath: "/rec/s1/screen.mkv",
    micFilePath: "/rec/s1/mic.mkv",
    micOffsetMs,
    micEq,
    format,
    screenCaptured: true,
    sceneEvents: [{ fileTime: 14, scene: "Camera" as const }],
  },
});

const QUIETER_HIGHS = { lowDb: 0, midDb: 0, highDb: -3 };

describe("a CVM-recorder Clip's Export Hash", () => {
  const hash = (rows: Parameters<typeof toExportClips>[0]) =>
    computeExportHash(toExportClips(rows), "landscape", []);
  const base = hash([sessionRow(150)]);

  it("moves when the Scene Override, mic offset or mic EQ changes", () => {
    expect(hash([{ ...sessionRow(150), sceneOverride: "Code" }])).not.toBe(
      base
    );
    expect(hash([sessionRow(180)])).not.toBe(base);
    expect(hash([sessionRow(150, QUIETER_HIGHS)])).not.toBe(base);
    // The saved default reads exactly as no saved setting at all.
    expect(hash([sessionRow(150, { lowDb: 0, midDb: 0, highDb: -6.1 })])).toBe(
      base
    );
  });
});

describe("a Landscape CVM-recorder Clip's Export Hash", () => {
  it("keeps its address now Recording Sessions remember their format", () => {
    // Computed on main before the Short layout reached the Export Hash, then
    // moved once by layout versions 2 and 3 (bilinear item scaling).
    const clips = toExportClips([sessionRow(150)]);
    expect(computeExportHash(clips, "landscape", [])).toBe(
      "040fe2894dcfead6bb03c0086f432b97"
    );
  });

  it("is re-addressed on a Short, where it is now drawn in the Short layout", () => {
    // Was 7d710ca8c4838658be6378bf73a76a28 while it was drawn squashed.
    const onAShort = computeExportHash(
      toExportClips([sessionRow(150)]),
      "short",
      []
    );
    expect(onAShort).toBe("5521d112a89503ed83083ef95968908f");
    // The same picture as the same Clip filmed for a Short.
    expect(onAShort).toBe(
      computeExportHash(
        toExportClips([sessionRow(150, null, "short")]),
        "short",
        []
      )
    );
  });
});

describe("a Short CVM-recorder Clip's Export Hash", () => {
  const clips = toExportClips([sessionRow(150, null, "short")]);

  it("keeps its address on a Short", () => {
    expect(computeExportHash(clips, "short", [])).toBe(
      "5521d112a89503ed83083ef95968908f"
    );
  });

  it("is not the same Clip's as if filmed in Landscape, on a Landscape Video (its fields carry the Short layout version: clip-source.test.ts)", () => {
    expect(computeExportHash(clips, "landscape", [])).not.toBe(
      computeExportHash(toExportClips([sessionRow(150)]), "landscape", [])
    );
  });
});
