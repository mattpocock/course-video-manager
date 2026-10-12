import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  compositePlaybackReducer,
  compositeScene,
  createInitialCompositePlaybackState,
} from "./composite-playback-reducer";

/**
 * A new-recorder Clip from 10 s to 14 s of picture time, Code until 12 s and
 * Camera after, with a 150 ms mic offset: its mic (the clock) plays from
 * 9.85 s.
 */
const start = () => {
  const tester = new ReducerTester(
    compositePlaybackReducer,
    createInitialCompositePlaybackState({
      segments: [
        { scene: "Code", startSeconds: 10, endSeconds: 12 },
        { scene: "Camera", startSeconds: 12, endSeconds: 14 },
      ],
      offsetSeconds: 0.15,
    })
  );
  // `effects` is what the last event declared.
  const t = {
    send(action: compositePlaybackReducer.Action) {
      tester.resetExec().send(action);
      return t;
    },
    get state() {
      return tester.getState();
    },
    get effects() {
      return tester.getEffects();
    },
  };
  return t;
};

const ticked = (clockTime: number, sources = { camera: 0, screen: 0 }) =>
  ({
    type: "clock-ticked",
    clockTime,
    sourceTimes: {
      camera: sources.camera || clockTime + 0.15,
      screen: sources.screen || clockTime + 0.15,
    },
  }) as const;

describe("playing a new-recorder Clip as the composite", () => {
  it("plays the camera and screen in the picture's clock, the mic offset after the mic", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    expect(t.effects).toEqual([{ type: "play-sources", at: 10, rate: 1 }]);
    expect(compositeScene(t.state)).toBe("Code");
  });

  it("switches scene where the Recording Session switched, inside the Clip", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send(ticked(11.5));
    expect(compositeScene(t.state)).toBe("Code");
    t.send(ticked(11.86));
    expect(compositeScene(t.state)).toBe("Camera");
    expect(t.effects).toEqual([]);
  });

  it("pulls back a picture that drifts from the mic, once until it lands", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send(ticked(11, { camera: 10.7, screen: 11.15 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.15, sources: ["camera"] },
    ]);
    t.send(ticked(11.02, { camera: 10.7, screen: 11.17 }));
    expect(t.effects).toEqual([]);
    t.send({ type: "source-seeked", source: "camera" });
    t.send(ticked(11.5, { camera: 11.2, screen: 11.65 }));
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 11.65, sources: ["camera"] },
    ]);
  });

  it("pauses and scrubs the picture with the mic", () => {
    const t = start().send({ type: "clock-played", clockTime: 9.85, rate: 1 });
    t.send({ type: "clock-paused", clockTime: 10.35 });
    expect(t.effects).toEqual([{ type: "pause-sources", at: 10.5 }]);
    t.send({ type: "clock-seeked", clockTime: 13.35 });
    expect(t.effects).toEqual([
      { type: "seek-sources", at: 13.5, sources: ["camera", "screen"] },
    ]);
    expect(compositeScene(t.state)).toBe("Camera");
  });

  it("does not chase drift while paused", () => {
    const t = start().send(ticked(11, { camera: 9, screen: 9 }));
    expect(t.effects).toEqual([]);
  });

  it("redraws in the scene a changed Clip Source says", () => {
    const t = start().send({
      type: "clip-source-changed",
      segments: [{ scene: "No Face", startSeconds: 10, endSeconds: 14 }],
      offsetSeconds: 0.15,
    });
    expect(compositeScene(t.state)).toBe("No Face");
  });

  it("follows the mic's playback rate", () => {
    const t = start().send({ type: "clock-rate-changed", rate: 2 });
    expect(t.effects).toEqual([{ type: "set-sources-rate", rate: 2 }]);
  });
});
