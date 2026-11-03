import { describe, expect, it } from "vitest";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import { clipLayerFlags, clipLayersShown, clipsFlagged } from "./clip-layers";

const scene = (position: number, volume = 1): ClipLayerRow => ({
  position,
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
  volume,
  spanAt: null,
  spanDuration: null,
});

const footage = (
  position: number,
  over: Partial<ClipLayerRow> = {}
): ClipLayerRow => ({
  position,
  kind: "footage",
  footagePath: "imported/demo.mp4",
  footageStart: 12.5,
  sessionFile: null,
  cropX: 0,
  cropY: 0,
  cropW: 0.5,
  cropH: 1,
  placeX: 0,
  placeY: 0,
  placeW: 1080,
  placeH: 960,
  volume: 0,
  spanAt: null,
  spanDuration: null,
  ...over,
});

/** A 10 s Clip of a Recording Session that captured its screen. */
const clip = (layers?: readonly ClipLayerRow[]) => ({
  sourceStartTime: 100,
  sourceEndTime: 110,
  recordingSession: { screenCaptured: true },
  layers,
});

describe("clipLayersShown", () => {
  it("shows an untouched Clip as its single Scene Layer", () => {
    expect(clipLayersShown(clip())).toEqual([
      {
        index: 0,
        kind: "Scene",
        footage: "Its own source",
        sourceCrop: "—",
        placement: "Scene layout",
        volume: "100%",
        span: "Whole Clip",
      },
    ]);
  });

  it("shows every Layer bottom to top: Kind, Footage, Source Crop, Placement, volume and span", () => {
    expect(
      clipLayersShown(
        clip([
          footage(2, {
            footagePath: null,
            footageStart: null,
            sessionFile: "camera",
            cropX: 0.25,
            cropW: 0.5,
            placeY: 960,
            volume: 0.5,
            spanAt: 1.5,
            spanDuration: 3,
          }),
          scene(0),
          footage(1),
        ])
      )
    ).toEqual([
      {
        index: 0,
        kind: "Scene",
        footage: "Its own source",
        sourceCrop: "—",
        placement: "Scene layout",
        volume: "100%",
        span: "Whole Clip",
      },
      {
        index: 1,
        kind: "Footage",
        footage: "imported/demo.mp4 from 12.5s",
        sourceCrop: "0, 0, 0.5 × 1",
        placement: "0, 0, 1080 × 960",
        volume: "Muted",
        span: "Whole Clip",
      },
      {
        index: 2,
        kind: "Footage",
        footage: "Its Recording Session's camera",
        sourceCrop: "0.25, 0, 0.5 × 1",
        placement: "0, 960, 1080 × 960",
        volume: "50%",
        span: "1.5s to 4.5s",
      },
    ]);
  });
});

describe("clipLayerFlags", () => {
  it("flags nothing on an untouched Clip, or on Footage that fills the frame for the whole Clip", () => {
    expect(clipLayerFlags(clip(), "short")).toEqual([]);
    expect(
      clipLayerFlags(
        clip([footage(0, { placeW: 1080, placeH: 1920, cropW: 1 })]),
        "short"
      )
    ).toEqual([]);
  });

  it("flags a span that starts after the Clip ends, and one that runs past its end", () => {
    expect(
      clipLayerFlags(
        clip([
          scene(0),
          footage(1, { spanAt: 12, spanDuration: 2 }),
          footage(2, { spanAt: 8, spanDuration: 4 }),
        ]),
        "short"
      )
    ).toEqual([
      {
        layer: 1,
        message:
          "Never drawn: its span starts at 12s, after the Clip ends (10s)",
      },
      {
        layer: 2,
        message:
          "Its span runs to 12s, past the Clip's end (10s): it is cut there",
      },
    ]);
  });

  it("flags a Placement partly or wholly outside a Short's 1080x1920 frame", () => {
    expect(
      clipLayerFlags(
        clip([
          scene(0),
          footage(1, { placeX: 540 }),
          footage(2, { placeY: 1920 }),
        ]),
        "short"
      )
    ).toEqual([
      { layer: 1, message: "Partly outside the 1080x1920 frame" },
      { layer: 2, message: "Never seen: its Placement is off the frame" },
    ]);
  });

  it("flags a Placement partly or wholly outside a Landscape Video's 1920x1080 frame", () => {
    const layers = [
      scene(0),
      footage(1, { placeX: 1440, placeW: 480, placeH: 270 }),
      footage(2, { placeY: 960, placeW: 480, placeH: 270 }),
      footage(3, { placeX: 1920, placeW: 480, placeH: 270 }),
    ];
    // Inside 1920x1080, though it would be off a Short's 1080 width.
    expect(clipLayerFlags(clip(layers), "landscape")).toEqual([
      { layer: 2, message: "Partly outside the 1920x1080 frame" },
      { layer: 3, message: "Never seen: its Placement is off the frame" },
    ]);
    expect(clipLayerFlags(clip(layers), "short")).toEqual([
      { layer: 1, message: "Never seen: its Placement is off the frame" },
      { layer: 3, message: "Never seen: its Placement is off the frame" },
    ]);
  });

  it("flags where a Clip with no Scene Layer draws nothing but black", () => {
    expect(
      clipLayerFlags(
        clip([
          footage(0, { spanAt: 2, spanDuration: 3 }),
          footage(1, { spanAt: 4, spanDuration: 2 }),
        ]),
        "short"
      )
    ).toEqual([
      { layer: null, message: "Black from 0s to 2s: no Layer draws there" },
      { layer: null, message: "Black from 6s to 10s: no Layer draws there" },
    ]);
  });

  it("flags a Clip whose every Layer is muted, and a Layer it could not export", () => {
    expect(clipLayerFlags(clip([scene(0, 0), footage(1)]), "short")).toEqual([
      { layer: null, message: "Silent: every Layer's volume is 0" },
    ]);
    expect(
      clipLayerFlags(
        {
          ...clip([footage(0, { sessionFile: "screen", footagePath: null })]),
          recordingSession: { screenCaptured: false },
        },
        "short"
      )
    ).toEqual([
      {
        layer: null,
        message:
          "Layer 0: its Footage is the Recording Session's screen, but that session captured no screen",
      },
    ]);
  });
});

describe("clipsFlagged", () => {
  it("names only the Clips with a flag, numbered from 1", () => {
    const silent = clip([scene(0, 0)]);
    expect(clipsFlagged([clip(), silent, clip()], "short")).toEqual([
      {
        clip: silent,
        number: 2,
        flags: [{ layer: null, message: "Silent: every Layer's volume is 0" }],
      },
    ]);
  });
});
