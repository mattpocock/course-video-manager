import { describe, expect, it } from "vitest";
import {
  computeExportHash,
  type ExportClip,
  type ExportOverlay,
} from "@/services/export-hash";

// ===========================================================================
// The Export Hash and an Overlay's animation toggles
//
// The same seam as export-hash.test.ts, in its own file only because that one
// is at the repo's per-file token budget. Read it first — it covers the rest of
// what an Overlay contributes to the address, and the "omitted when it is the
// default" rule these two cases are another instance of.
// ===========================================================================

const card = (overrides: Partial<ExportOverlay> = {}): ExportOverlay => ({
  at: 2,
  durationInSeconds: 4,
  kind: "bulletPanel",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "Hydration",
  description: "Attaching handlers to server-rendered HTML.",
  bullets: null,
  ...overrides,
});

const withOverlays = (...overlays: ExportOverlay[]) =>
  computeExportHash(
    [
      {
        videoFilename: "rec.mp4",
        sourceStartTime: 0,
        sourceEndTime: 10,
        pauseType: "none",
        zoomType: "none",
        overlays,
      } satisfies ExportClip,
    ],
    "landscape",
    []
  );

describe("an Overlay's animation toggles", () => {
  it("change the address, because they change the camera move", () => {
    // Each toggle collapses one end of the Transform to a cut, so the exported
    // frames differ — an export addressed before the toggle was set must not
    // be reused after it.
    expect(withOverlays(card({ disableEnterAnimation: true }))).not.toBe(
      withOverlays(card())
    );
    expect(withOverlays(card({ disableExitAnimation: true }))).not.toBe(
      withOverlays(card())
    );
  });

  it("are told apart from each other", () => {
    expect(withOverlays(card({ disableEnterAnimation: true }))).not.toBe(
      withOverlays(card({ disableExitAnimation: true }))
    );
  });
});

describe("a Definition Card in the address", () => {
  it("is where it was before B-roll came and went", () => {
    // Pinned before B-roll existed, and unchanged by its removal.
    expect(withOverlays(card({ kind: "definitionCard" }))).toBe(
      "506d7e9fe1da53c7e56f0d1b398164fa"
    );
  });
});

describe("a Chat Card in the address", () => {
  const chatCard = (overrides: Partial<ExportOverlay> = {}): ExportOverlay =>
    card({
      kind: "chatCard",
      title: "@fake_viewer_1",
      description: "A fake question?",
      ...overrides,
    });

  it("changes when its author or text changes", () => {
    expect(withOverlays(chatCard({ title: "@fake_viewer_9" }))).not.toBe(
      withOverlays(chatCard())
    );
    expect(withOverlays(chatCard({ description: "Another?" }))).not.toBe(
      withOverlays(chatCard())
    );
  });
});

describe("a Call to Action in the address", () => {
  const callToAction = (overrides: Partial<ExportOverlay> = {}) =>
    card({
      kind: "callToAction",
      title: "example.com",
      description: "A fake subline",
      ...overrides,
    });

  it("changes when its headline or subline changes", () => {
    expect(withOverlays(callToAction({ title: "example.org" }))).not.toBe(
      withOverlays(callToAction())
    );
    expect(withOverlays(callToAction({ description: "Another" }))).not.toBe(
      withOverlays(callToAction())
    );
  });
});
