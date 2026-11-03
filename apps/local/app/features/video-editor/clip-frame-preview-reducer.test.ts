import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialClipFramePreviewState,
  clipFramePreview,
  clipFramePreviewReducer,
  clipFrameRequest,
  type ClipFrameClip,
  type ClipFrameRequest,
} from "./clip-frame-preview-reducer";
import type { ClipOverlay } from "./overlay-preview";

/** A 10 s Clip, 100s to 110s into its source. */
const clip: ClipFrameClip = {
  databaseId: "c1",
  sourceStartTime: 100,
  sourceEndTime: 110,
  text: "hello",
  layers: [],
};

const paused: Parameters<typeof clipFrameRequest>[0] = {
  clip,
  overlays: [],
  runningState: "paused",
  scrubSeekTime: undefined,
  currentTimeInClip: 0,
  round: "",
};

describe("clipFrameRequest", () => {
  it("asks for nothing while playing, or with no saved Clip", () => {
    expect(clipFrameRequest({ ...paused, runningState: "playing" })).toBeNull();
    expect(clipFrameRequest({ ...paused, clip: undefined })).toBeNull();
  });

  it("asks for the frame showing at the scrub, in seconds into the Clip on the render's 60 fps", () => {
    const request = clipFrameRequest({ ...paused, scrubSeekTime: 102.509 });
    expect(request).toMatchObject({ clipId: "c1", at: 2.5 });
    expect(request!.url).toMatch(/^\/clips\/c1\/frame\?at=2\.5&v=/);
  });

  it("asks for where playback stopped when nothing was scrubbed", () => {
    expect(
      clipFrameRequest({ ...paused, currentTimeInClip: 4.01 })
    ).toMatchObject({ at: 4 });
  });

  it("keeps the time inside the Clip: its first frame to its last", () => {
    expect(clipFrameRequest({ ...paused, scrubSeekTime: 99 })).toMatchObject({
      at: 0,
    });
    expect(clipFrameRequest({ ...paused, scrubSeekTime: 110 })).toMatchObject({
      at: 599 / 60,
    });
  });

  it("asks afresh when the Clip's Layers or words change, or after a Stop, but not otherwise", () => {
    const url = (over: Partial<typeof paused>) =>
      clipFrameRequest({ ...paused, ...over })!.url;
    const before = url({});
    expect(url({})).toBe(before);
    expect(url({ round: "session-2" })).not.toBe(before);
    expect(url({ clip: { ...clip, text: "hello there" } })).not.toBe(before);
    expect(
      url({
        clip: {
          ...clip,
          layers: [
            {
              position: 0,
              kind: "scene",
              footagePath: null,
              footageStart: null,
              sessionFile: null,
              cropX: null,
              cropY: null,
              cropW: null,
              cropH: null,
              placeX: null,
              placeY: null,
              placeW: null,
              placeH: null,
              volume: 0.5,
              spanAt: null,
              spanDuration: null,
            },
          ],
        },
      })
    ).not.toBe(before);
  });
});

/** A Definition Card over a Landscape Clip, 0.5 s into it for 2 s. */
const card: ClipOverlay = {
  id: "o1",
  clipId: "c2",
  at: 0.5,
  durationInSeconds: 2,
  kind: "definitionCard",
  bullets: null,
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "Term",
  description: "what it means",
  chatSpin: null,
};

/** A 10 s Landscape Clip with Footage Layers only, under that card. */
const landscape: Parameters<typeof clipFrameRequest>[0] = {
  ...paused,
  clip: {
    databaseId: "c2",
    sourceStartTime: 20,
    sourceEndTime: 30,
    text: "hello",
    layers: [
      {
        position: 0,
        kind: "footage",
        footagePath: "imported/demo.mp4",
        footageStart: 0,
        sessionFile: null,
        cropX: 0,
        cropY: 0,
        cropW: 1,
        cropH: 1,
        placeX: 0,
        placeY: 0,
        placeW: 1920,
        placeH: 1080,
        volume: 0,
        spanAt: null,
        spanDuration: null,
      },
    ],
  },
  overlays: [card],
  scrubSeekTime: 21,
};

describe("clipFrameRequest on a Landscape Clip", () => {
  it("asks the same route for its frame, and afresh when an Overlay over it changes", () => {
    const request = clipFrameRequest(landscape)!;
    expect(request).toMatchObject({ clipId: "c2", at: 1 });
    expect(request.url).toMatch(/^\/clips\/c2\/frame\?at=1&v=/);

    const url = (overlays: readonly ClipOverlay[]) =>
      clipFrameRequest({ ...landscape, overlays })!.url;
    expect(url([card])).toBe(request.url);
    expect(url([])).not.toBe(request.url);
    expect(url([{ ...card, title: "Other" }])).not.toBe(request.url);
    expect(url([{ ...card, at: 0.6 }])).not.toBe(request.url);
  });
});

const request = (at: number): ClipFrameRequest => ({
  clipId: "c1",
  at,
  search: `at=${at}&v=x`,
  url: `/clips/c1/frame?at=${at}&v=x`,
});

const preview = () =>
  new ReducerTester(
    clipFramePreviewReducer,
    createInitialClipFramePreviewState()
  );

describe("clipFramePreviewReducer", () => {
  it("draws the frame asked for and shows it once drawn", () => {
    const tester = preview().send({
      type: "frame-wanted",
      request: request(1),
    });
    expect(clipFramePreview(tester.getState())).toEqual({
      image: null,
      status: "drawing",
      message: null,
    });

    tester.send({
      type: "frame-drawn",
      url: request(1).url,
      image: "blob:1",
    });
    expect(clipFramePreview(tester.getState())).toEqual({
      image: "blob:1",
      status: "shown",
      message: null,
    });
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
    ]);
  });

  it("while scrubbing draws one frame at a time, then only the latest asked for", () => {
    const tester = preview()
      .send({ type: "frame-wanted", request: request(1) })
      .send({ type: "frame-wanted", request: request(2) })
      .send({ type: "frame-wanted", request: request(3) })
      .send({ type: "frame-drawn", url: request(1).url, image: "blob:1" });

    // Frame 1 is not the one wanted any more: not shown.
    expect(clipFramePreview(tester.getState()).image).toBeNull();
    tester.send({ type: "frame-drawn", url: request(3).url, image: "blob:3" });

    expect(clipFramePreview(tester.getState()).image).toBe("blob:3");
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
      { type: "draw-frame", request: request(3) },
      { type: "release-frame-image", image: "blob:1" },
    ]);
  });

  it("shows a frame already drawn at once, and lets the old one go", () => {
    const tester = preview()
      .send({ type: "frame-wanted", request: request(1) })
      .send({ type: "frame-drawn", url: request(1).url, image: "blob:1" })
      .send({ type: "frame-wanted", request: request(2) })
      .send({ type: "frame-drawn", url: request(2).url, image: "blob:2" })
      .send({ type: "frame-wanted", request: request(2) });

    expect(clipFramePreview(tester.getState()).image).toBe("blob:2");
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
      { type: "draw-frame", request: request(2) },
      { type: "release-frame-image", image: "blob:1" },
    ]);
  });

  it("while recording says the frame is held, and asks again after the Stop", () => {
    const tester = preview()
      .send({ type: "frame-wanted", request: request(1) })
      .send({ type: "frame-held", url: request(1).url })
      .send({ type: "frame-wanted", request: request(1) });

    expect(clipFramePreview(tester.getState())).toEqual({
      image: null,
      status: "held",
      message: "No preview while recording: it asks again after the Stop",
    });

    // The Stop is a new round, so a new request for the same time.
    const afterStop = {
      ...request(1),
      search: "at=1&v=y",
      url: "/clips/c1/frame?at=1&v=y",
    };
    tester.send({ type: "frame-wanted", request: afterStop });
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
      { type: "draw-frame", request: afterStop },
    ]);
  });

  it("says why a frame could not be drawn, and draws the next one asked for", () => {
    const tester = preview()
      .send({ type: "frame-wanted", request: request(1) })
      .send({
        type: "frame-failed",
        url: request(1).url,
        message: "Footage offline",
      });
    expect(clipFramePreview(tester.getState())).toEqual({
      image: null,
      status: "failed",
      message: "Footage offline",
    });

    tester.send({ type: "frame-wanted", request: request(2) });
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
      { type: "draw-frame", request: request(2) },
    ]);
  });

  it("asks for nothing while playing, and keeps the last frame for when it pauses there", () => {
    const tester = preview()
      .send({ type: "frame-wanted", request: request(1) })
      .send({ type: "frame-drawn", url: request(1).url, image: "blob:1" })
      .send({ type: "frame-wanted", request: null });
    expect(clipFramePreview(tester.getState())).toEqual({
      image: null,
      status: "idle",
      message: null,
    });

    tester.send({ type: "frame-wanted", request: request(1) });
    expect(clipFramePreview(tester.getState()).image).toBe("blob:1");
    expect(tester.getEffects()).toEqual([
      { type: "draw-frame", request: request(1) },
    ]);
  });
});
