import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleOverlayRenderer, renderSubtitleOverlay } from "../src/render";
import type { OverlayProps } from "../src/props";

// Real Chromium render — heavy. Bundle once, render a tiny overlay, and assert
// the produced asset. This is the package's public seam: props -> overlay.
describe("renderSubtitleOverlay", () => {
  let workDir: string;
  let serveUrl: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "overlay-render-"));
    serveUrl = await bundleOverlayRenderer();
  }, 300_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("renders a transparent 1080x1920 overlay from explicit props", async () => {
    const props: OverlayProps = {
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 40,
      subtitles: [
        { startFrame: 0, endFrame: 20, text: "hello there" },
        { startFrame: 20, endFrame: 40, text: "general kenobi" },
      ],
      // Realistic CTA length (fade-in + hold + fade-out needs > ~20 frames).
      cta: { variant: "ai", durationInFrames: 40 },
    };
    const outputLocation = path.join(workDir, "overlay.mov");

    const result = await renderSubtitleOverlay(props, {
      outputLocation,
      serveUrl,
    });

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.fps).toBe(60);
    expect(result.durationInFrames).toBe(40);

    const fileStat = await stat(outputLocation);
    expect(fileStat.size).toBeGreaterThan(0);
  }, 600_000);

  it("renders when a non-final subtitle collapses to zero frames", async () => {
    // A very short word can have its start/end round to the same frame,
    // producing a zero-length subtitle segment. The renderer must not crash
    // with "durationInFrames must be positive, but got 0".
    const props: OverlayProps = {
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 12,
      subtitles: [
        { startFrame: 0, endFrame: 4, text: "your effort" },
        { startFrame: 4, endFrame: 4, text: "is" },
        { startFrame: 4, endFrame: 12, text: "too damn high" },
      ],
      cta: null,
    };
    const outputLocation = path.join(workDir, "overlay-zero-len.mov");

    const result = await renderSubtitleOverlay(props, {
      outputLocation,
      serveUrl,
    });

    expect(result.durationInFrames).toBe(12);
    const fileStat = await stat(outputLocation);
    expect(fileStat.size).toBeGreaterThan(0);
  }, 600_000);

  it("renders without a CTA", async () => {
    const props: OverlayProps = {
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 12,
      subtitles: [{ startFrame: 0, endFrame: 12, text: "no cta here" }],
      cta: null,
    };
    const outputLocation = path.join(workDir, "overlay-no-cta.mov");

    const result = await renderSubtitleOverlay(props, {
      outputLocation,
      serveUrl,
    });

    expect(result.durationInFrames).toBe(12);
    const fileStat = await stat(outputLocation);
    expect(fileStat.size).toBeGreaterThan(0);
  }, 600_000);
});
