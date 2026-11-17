import { describe, expect, it } from "vitest";
import { previewGainDb } from "./preview-gain";

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
