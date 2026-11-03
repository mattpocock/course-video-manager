import { describe, expect, it } from "vitest";
import {
  computeExportHash,
  type ExportClip,
  type ExportOverlay,
} from "@/services/export-hash";

/**
 * What the camera move's version does to the export address.
 *
 * An export is CONTENT-ADDRESSED: a Video whose address has not changed is not
 * re-exported, whatever the code now does. The move's arithmetic is code and
 * not data, so it is invisible to the address — which means a fix to the move
 * reaches every Video EXCEPT the ones that already have the old move baked into
 * a file. `OVERLAY_CAMERA_VERSION` is how the address is told.
 *
 * It has to be told PRECISELY. Bumping `EXPORT_VERSION` would re-export the
 * whole library to produce, for almost every Video, exactly the bytes it
 * already has. So the version rides on an Overlay whose Kind actually moves the
 * camera, and on nothing else — and that is the pair of facts this file pins,
 * from both sides, with the literal addresses themselves.
 *
 * It lives apart from `export-hash.test.ts` because that file is at the repo's
 * per-file size limit.
 */

const overlay = (overrides: Partial<ExportOverlay> = {}): ExportOverlay => ({
  at: 2,
  durationInSeconds: 4,
  kind: "definitionCard",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "Hydration",
  description: "Attaching handlers to server-rendered HTML.",
  bullets: null,
  ...overrides,
});

const clip = (overlays: ExportOverlay[]): ExportClip => ({
  videoFilename: "rec.mp4",
  sourceStartTime: 0,
  sourceEndTime: 10,
  pauseType: "none",
  zoomType: "none",
  overlays,
});

const addressOf = (...overlays: ExportOverlay[]) =>
  computeExportHash([clip(overlays)], "landscape", []);

describe("the camera move's version in the export address", () => {
  /**
   * A Definition Card moves no camera, so it must carry NOTHING — otherwise
   * every Video in the library re-exports to produce the bytes it already has.
   *
   * The literal is the address a Definition Card video had BEFORE the camera
   * version existed, recomputed independently from the payload rather than
   * copied out of a test run. If it moves, the version has leaked onto
   * Overlays that have no camera.
   */
  it("leaves a Definition Card's address exactly where it was", () => {
    expect(addressOf(overlay())).toBe("506d7e9fe1da53c7e56f0d1b398164fa");
  });

  /**
   * The other half of the same rule. A Bullet Panel DOES move the camera, so
   * it must carry the version, and a Video exported with the old drifting move
   * is re-addressed rather than keeping bytes that no longer match what this
   * code renders.
   *
   * The first literal is the address that same Overlay had before the version
   * existed. It must not still be in use.
   */
  it("moves a Bullet Panel's address, so an old export cannot be kept", () => {
    const panel = overlay({ kind: "bulletPanel" });
    expect(addressOf(panel)).not.toBe("41a4047b58f30b4c4eddfea603e10a89");
    expect(addressOf(panel)).toBe("c300c12668892ca79a9e727a008dc231");
  });
});
