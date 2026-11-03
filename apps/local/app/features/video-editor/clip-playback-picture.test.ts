import { describe, expect, it } from "vitest";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import { clipSource } from "@/packages/clip-source";
import { clipPlaybackBase, clipPlaybackStyles } from "./clip-playback-picture";
import type { ClipOverlay } from "./overlay-preview";

// How the editor's playback draws a Clip's picture, as the export does
// (#2606). Fixture paths only.

const footageLayer: ClipLayerRow = {
  position: 0,
  kind: "footage",
  footagePath: "/fixtures/broll.mp4",
  footageStart: 0,
  sessionFile: null,
  volume: 0,
  spanAt: null,
  spanDuration: null,
  cropX: 0,
  cropY: 0,
  cropW: 1,
  cropH: 1,
  placeX: 0,
  placeY: 0,
  placeW: 960,
  placeH: 540,
};

const sceneLayer: ClipLayerRow = {
  ...footageLayer,
  kind: "scene",
  footagePath: null,
  footageStart: null,
  volume: 1,
  cropX: null,
  cropY: null,
  cropW: null,
  cropH: null,
  placeX: null,
  placeY: null,
  placeW: null,
  placeH: null,
};

const singleFileClip = (layers: ClipLayerRow[]) =>
  clipSource({
    videoFilename: "/fixtures/obs.mkv",
    sourceStartTime: 1,
    sourceEndTime: 3,
    recordingSessionId: null,
    sceneOverride: null,
    recordingSession: null,
    layers,
  });

const sessionClip = (layers: ClipLayerRow[]) =>
  clipSource(
    {
      videoFilename: "/fixtures/mic.wav",
      sourceStartTime: 1,
      sourceEndTime: 3,
      recordingSessionId: "session-1",
      sceneOverride: null,
      layers,
      recordingSession: {
        id: "session-1",
        screenFilePath: "/fixtures/screen.mkv",
        cameraFilePath: "/fixtures/camera.mkv",
        micFilePath: "/fixtures/mic.wav",
        micOffsetMs: 0,
        format: "landscape",
        screenCaptured: true,
        sceneEvents: [],
      },
    },
    { videoFormat: "landscape" }
  );

describe("clipPlaybackBase", () => {
  it("draws an untouched Clip's own picture", () => {
    expect(clipPlaybackBase(singleFileClip([]))).toBe("scene");
    expect(clipPlaybackBase(sessionClip([]))).toBe("scene");
  });

  it("draws the Scene Layer under a Clip's Footage Layers", () => {
    const layers = [sceneLayer, { ...footageLayer, position: 1 }];
    expect(clipPlaybackBase(singleFileClip(layers))).toBe("scene");
    expect(clipPlaybackBase(sessionClip(layers))).toBe("scene");
  });

  it("plays a single-file Clip with no Scene Layer on black, not its own file", () => {
    expect(clipPlaybackBase(singleFileClip([footageLayer]))).toBe("black");
  });

  it("plays a session Clip with no Scene Layer on black", () => {
    expect(clipPlaybackBase(sessionClip([footageLayer]))).toBe("black");
  });
});

const bulletPanel: ClipOverlay = {
  id: "ovl_1",
  clipId: "clip_1",
  at: 0,
  durationInSeconds: 6,
  kind: "bulletPanel",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "A fixture panel",
  description: "",
  bullets: [],
};

describe("clipPlaybackStyles", () => {
  it("slides the whole picture, every Layer, with a Bullet Panel's Transform", () => {
    // 3 s in, the move has arrived: 406 px of the 1920 px frame.
    const styles = clipPlaybackStyles({
      overlays: [bulletPanel],
      currentTime: 3,
      zoomType: "none",
    });
    expect(styles.picture).toEqual({
      transform: `translateX(${(406 / 1920) * 100}%)`,
    });
    // Not again on the scene, which sits inside the picture.
    expect(styles.scene).toBeUndefined();
  });

  it("slides the picture partway mid-move", () => {
    const { picture } = clipPlaybackStyles({
      overlays: [bulletPanel],
      currentTime: 0.4,
      zoomType: "none",
    });
    const percent = Number(
      /translateX\(([\d.]+)%\)/.exec(picture!.transform!)![1]
    );
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan((406 / 1920) * 100);
  });

  it("moves nothing outside the Overlay", () => {
    expect(
      clipPlaybackStyles({
        overlays: [bulletPanel],
        currentTime: 7,
        zoomType: "none",
      })
    ).toEqual({ picture: undefined, scene: undefined });
  });

  it("zooms only the Scene Layer with a Clip Zoom", () => {
    const styles = clipPlaybackStyles({
      overlays: [],
      currentTime: 1,
      zoomType: "subtle",
    });
    expect(styles.picture).toBeUndefined();
    expect(styles.scene?.transform).toMatch(/^scale\(/);
  });
});
