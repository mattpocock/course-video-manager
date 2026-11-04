import { describe, expect, it } from "vitest";
import {
  createInitialTakeEndFrameState,
  takeEndFrameReducer,
} from "./take-end-frame-reducer";

const run = (actions: takeEndFrameReducer.Action[]) =>
  actions.reduce(takeEndFrameReducer, createInitialTakeEndFrameState());

describe("the take-end frame of the last-frame overlay", () => {
  it("gives each live take's Clip the picture from its speech end, keeps it while the insertion point moves, and drops them all at the Stop", () => {
    const afterTwoTakes = run([
      { type: "speech-ended", picture: "pause-mid-take" },
      { type: "speech-ended", picture: "end-of-take-1" },
      { type: "overlay-clip-shown", clipId: "c1", takeEnd: true },
      { type: "speech-ended", picture: "end-of-take-2" },
      { type: "overlay-clip-shown", clipId: "c2", takeEnd: true },
      // The insertion point moved back to the first take's Clip.
      { type: "overlay-clip-shown", clipId: "c1", takeEnd: true },
    ]);
    expect(afterTwoTakes.frames).toEqual({
      c1: "end-of-take-1",
      c2: "end-of-take-2",
    });

    // A Clip with a saved still never takes the pending picture.
    const older = run([
      { type: "speech-ended", picture: "end-of-take-3" },
      { type: "overlay-clip-shown", clipId: "old", takeEnd: false },
      { type: "overlay-clip-shown", clipId: "c3", takeEnd: true },
    ]);
    expect(older.frames).toEqual({ c3: "end-of-take-3" });

    expect(
      takeEndFrameReducer(afterTwoTakes, { type: "still-round-changed" })
    ).toEqual(createInitialTakeEndFrameState());
  });
});
