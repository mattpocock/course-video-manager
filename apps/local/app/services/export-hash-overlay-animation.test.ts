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
  footagePath: null,
  footageStart: null,
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

describe("a B-roll in the address", () => {
  const bRoll = (overrides: Partial<ExportOverlay> = {}): ExportOverlay =>
    card({
      kind: "bRoll",
      title: "",
      description: "",
      footagePath: "raw-footage/imported/city.mp4",
      footageStart: 12,
      ...overrides,
    });

  it("changes when its Footage or its from changes", () => {
    expect(
      withOverlays(bRoll({ footagePath: "raw-footage/imported/park.mp4" }))
    ).not.toBe(withOverlays(bRoll()));
    expect(withOverlays(bRoll({ footageStart: 13 }))).not.toBe(
      withOverlays(bRoll())
    );
  });

  it("leaves a Video with only Definition Cards at the address it had", () => {
    // Pinned before B-roll existed: the Definition Card payload is unchanged.
    expect(
      withOverlays(
        card({ kind: "definitionCard", footagePath: null, footageStart: null })
      )
    ).toBe("506d7e9fe1da53c7e56f0d1b398164fa");
  });
});
