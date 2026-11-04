import { describe, expect, it } from "vitest";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import { clipFaceAreas, clipSource } from "@/packages/clip-source";
import type { ExportOverlay } from "./export-hash";
import { verticalOverlayProps } from "./vertical-overlay-props";

// A Short's Chat Card is never drawn over Matt's face (#2669): on every frame
// it is up, its box stays clear of where his face is, whatever the Layers.
// All chat is fake.

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where Matt's head was on the 2026-11-03 stream's camera frames, as
 * fractions of the camera's frame: measured by eye, not taken from the code.
 */
const MEASURED_HEAD = { x: 0.39, y: 0.07, w: 0.17, h: 0.39 };

/** The Chat Card at its tallest (four lines of message), in Short pixels. */
const CARD = { width: 960, height: 370 };

const session = {
  id: "session-1",
  cameraFilePath: "/fake/camera.mkv",
  screenFilePath: "/fake/screen.mkv",
  micFilePath: "/fake/mic.wav",
  micOffsetMs: 0,
  format: "landscape" as const,
  screenCaptured: true,
  micEq: null,
};

const footageLayer = (
  position: number,
  file: "camera" | "screen",
  crop: Box,
  place: Box
): ClipLayerRow => ({
  position,
  kind: "footage",
  footagePath: null,
  footageStart: null,
  sessionFile: file,
  cropX: crop.x,
  cropY: crop.y,
  cropW: crop.w,
  cropH: crop.h,
  placeX: place.x,
  placeY: place.y,
  placeW: place.w,
  placeH: place.h,
  volume: 0,
  spanAt: null,
  spanDuration: null,
});

/** One Clip of a Short, and where Matt's head is drawn in it (by hand). */
type Layout = {
  name: string;
  row: Parameters<typeof clipSource>[0];
  zoomType: string;
  /** The camera pictures it draws: a crop of the camera into a box. */
  cameras: { crop: Box; place: Box; zoom?: number }[];
};

const clip = (
  over: {
    layers?: ClipLayerRow[];
    scene?: "Camera" | "Code";
  } = {}
) => ({
  videoFilename: "",
  sourceStartTime: 0,
  sourceEndTime: 10,
  recordingSessionId: "session-1",
  sceneOverride: null,
  recordingSession: {
    ...session,
    sceneEvents: [{ fileTime: 0, scene: over.scene ?? "Code" }],
  },
  layers: over.layers ?? [],
});

const FULL_FRAME_CAMERA = { x: 0.338, y: 0, w: 0.316, h: 1 };

const LAYOUTS: Layout[] = [
  {
    name: "screen square over a camera band, from Footage Layers",
    row: clip({
      layers: [
        footageLayer(
          0,
          "screen",
          { x: 0, y: 0, w: 0.5625, h: 1 },
          { x: 0, y: 0, w: 1080, h: 1080 }
        ),
        footageLayer(
          1,
          "camera",
          { x: 0.14, y: 0, w: 0.72, h: 1 },
          { x: 0, y: 1080, w: 1080, h: 840 }
        ),
      ],
    }),
    zoomType: "none",
    cameras: [
      {
        crop: { x: 0.14, y: 0, w: 0.72, h: 1 },
        place: { x: 0, y: 1080, w: 1080, h: 840 },
      },
    ],
  },
  {
    name: "camera only, full frame, nudged 120 px down",
    row: clip({
      layers: [
        footageLayer(0, "camera", FULL_FRAME_CAMERA, {
          x: 0,
          y: 120,
          w: 1080,
          h: 1920,
        }),
      ],
    }),
    zoomType: "none",
    cameras: [
      { crop: FULL_FRAME_CAMERA, place: { x: 0, y: 120, w: 1080, h: 1920 } },
    ],
  },
  {
    name: "the Short layout's Camera scene, zoomed",
    row: clip({ scene: "Camera" }),
    zoomType: "subtle",
    cameras: [
      {
        crop: { x: 0.33801, y: 0, w: 0.31551, h: 0.9974 },
        place: { x: 0, y: 0, w: 1080, h: 1920 },
        zoom: 1.15,
      },
    ],
  },
  {
    name: "the Short layout's Code scene",
    row: clip({ scene: "Code" }),
    zoomType: "none",
    cameras: [
      {
        crop: { x: 0.20544, y: 0.04259, w: 0.56456, h: 0.78079 },
        place: { x: 0, y: 1080, w: 1080, h: 840 },
      },
    ],
  },
];

/** Matt's head, drawn through one camera picture, in Short pixels. */
const headIn = (camera: Layout["cameras"][number]): Box => {
  const { crop, place, zoom = 1 } = camera;
  const x0 = place.x + ((MEASURED_HEAD.x - crop.x) / crop.w) * place.w;
  const y0 = place.y + ((MEASURED_HEAD.y - crop.y) / crop.h) * place.h;
  const x1 =
    place.x + ((MEASURED_HEAD.x + MEASURED_HEAD.w - crop.x) / crop.w) * place.w;
  const y1 =
    place.y + ((MEASURED_HEAD.y + MEASURED_HEAD.h - crop.y) / crop.h) * place.h;
  // Clip Zoom scales the Scene Layer about (50%, 30%) of the frame.
  const zx = (x: number) => 540 + (x - 540) * zoom;
  const zy = (y: number) => 576 + (y - 576) * zoom;
  return { x: zx(x0), y: zy(y0), w: zx(x1) - zx(x0), h: zy(y1) - zy(y0) };
};

const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const chatCard = (overrides: Partial<ExportOverlay> = {}): ExportOverlay => ({
  at: 1,
  durationInSeconds: 5,
  kind: "chatCard",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "@fake_viewer_1",
  description: "A fake question?",
  bullets: null,
  ...overrides,
});

const render = (layouts: Layout[], card = chatCard()) =>
  verticalOverlayProps({
    fps: 60,
    durationInFrames: 600 * layouts.length,
    subtitles: [],
    clips: layouts.map((layout, index) => ({
      overlays: index === 0 ? [card] : [],
      faceAreas: clipFaceAreas(
        clipSource(layout.row, { videoFormat: "short" }),
        layout.zoomType
      ),
    })),
    clipDurations: layouts.map(() => ({ duration: 10, pauseType: "none" })),
  });

/** The card's box on every frame it is up: entrance, landed, exit. */
const cardBoxes = (card: ReturnType<typeof render>["chatCards"][number]) =>
  [...card.enter, { opacity: 1, offsetY: 0 }, ...card.exit].map((pose) => ({
    x: (1080 - CARD.width) / 2,
    y: card.top + pose.offsetY,
    w: CARD.width,
    h: CARD.height,
  }));

describe("a Short's Chat Card", () => {
  it.each(LAYOUTS)("never covers Matt's face on any frame: $name", (layout) => {
    const [card] = render([layout]).chatCards;
    const heads = layout.cameras.map(headIn);
    for (const box of cardBoxes(card!)) {
      for (const head of heads) expect(meets(box, head)).toBe(false);
    }
  });

  it("sits at the top of the Short when the face is below it", () => {
    expect(render([LAYOUTS[0]!]).chatCards[0]!.top).toBe(240);
  });

  it("moves below the captions when the face fills the top", () => {
    expect(render([LAYOUTS[1]!]).chatCards[0]!.top).toBeGreaterThan(1200);
  });

  it("is kept clear of the face in every Clip it runs across", () => {
    // Anchored on a camera-only Clip, running on into the Camera scene.
    const across = [LAYOUTS[1]!, LAYOUTS[2]!];
    const [card] = render(across, chatCard({ at: 8 })).chatCards;
    const heads = across.flatMap((layout) => layout.cameras).map(headIn);
    for (const box of cardBoxes(card!)) {
      for (const head of heads) expect(meets(box, head)).toBe(false);
    }
  });

  it("is refused when the faces under it leave it no clear place", () => {
    // From the band layout (face low) on into camera only (face high).
    expect(() =>
      render([LAYOUTS[0]!, LAYOUTS[1]!], chatCard({ at: 8 }))
    ).toThrow(/face/);
  });
});
