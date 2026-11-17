import { describe, expect, it } from "vitest";
import { clipPreviewGainDb, previewGainDb } from "./preview-gain";

describe("previewGainDb", () => {
  it("lifts a quiet measured file up to the export's −16 LUFS", () => {
    expect(previewGainDb({ measuredLufs: -24, imported: false })).toBe(8);
  });

  it("never turns a file louder than the export down", () => {
    expect(previewGainDb({ measuredLufs: -9, imported: true })).toBe(0);
  });

  it("adds at most 12 dB, however quiet the file", () => {
    expect(previewGainDb({ measuredLufs: -40, imported: false })).toBe(12);
  });

  it("gives unmeasured Imported Footage no boost: it was mixed elsewhere", () => {
    expect(previewGainDb({ measuredLufs: null, imported: true })).toBe(0);
  });

  it("gives unmeasured Footage CVM filmed today's full 12 dB", () => {
    expect(previewGainDb({ measuredLufs: null, imported: false })).toBe(12);
  });
});

describe("clipPreviewGainDb", () => {
  it("plays a Clip the loader judged at the loader's gain", () => {
    expect(
      clipPreviewGainDb({ "clip-1": 6 }, "clip-1", "raw-footage/imported/a.mp4")
    ).toBe(6);
  });

  it("gives an Imported Clip added after the editor loaded no boost", () => {
    expect(
      clipPreviewGainDb({}, "clip-new", "raw-footage/imported/interview.mp4")
    ).toBe(0);
  });

  it("gives a Clip filmed after the editor loaded the full boost", () => {
    expect(
      clipPreviewGainDb({}, "clip-new", "raw-footage/sessions/s1/mic.mka")
    ).toBe(12);
  });
});
