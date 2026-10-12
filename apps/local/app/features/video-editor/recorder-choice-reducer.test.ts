import { describe, expect, it } from "vitest";
import {
  createInitialRecorderChoiceState,
  isRecorderLocked,
  recorderChoiceReducer,
  showsNewRecorderControls,
  showsOBSChecks,
} from "./recorder-choice-reducer";
import type { TimelineItem } from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";

type Effect = { type: string; [key: string]: unknown };

const run = (
  state: recorderChoiceReducer.State,
  ...actions: recorderChoiceReducer.Action[]
) => {
  const effects: Effect[] = [];
  const next = actions.reduce(
    (s, action) =>
      recorderChoiceReducer(s, action, ((e: Effect) => {
        effects.push(e);
      }) as never),
    state
  );
  return { state: next, effects };
};

const landscape = (recorder: string | null = null) =>
  createInitialRecorderChoiceState({ format: "landscape", recorder });

const notRunning: OBSConnectionOuterState = { type: "obs-not-running" };
const recording: OBSConnectionOuterState = {
  type: "obs-recording",
  profile: "Landscape",
  scene: "Camera",
  latestOutputPath: "/out.mkv",
};
const chapter = {
  type: "chapter-on-database",
  frontendId: "c1",
  databaseId: "c1",
  name: "Intro",
  insertionOrder: null,
} as unknown as TimelineItem;
const clip = { type: "on-database", frontendId: "k1" } as TimelineItem;

describe("recorder choice", () => {
  it("every existing Video reads as OBS and shows the OBS checks", () => {
    const state = landscape(null);
    expect(state.recorder).toBe("obs");
    expect(showsOBSChecks(state)).toBe(true);
    expect(showsNewRecorderControls(state)).toBe(false);
  });

  it("picking the New recorder saves it, remembers it as the last choice and hides the OBS checks", () => {
    const { state, effects } = run(landscape(), {
      type: "recorder-picked",
      recorder: "new-recorder",
      locked: false,
    });
    expect(state.recorder).toBe("new-recorder");
    expect(showsOBSChecks(state)).toBe(false);
    // Record, the scene buttons and the composite preview.
    expect(showsNewRecorderControls(state)).toBe(true);
    expect(effects).toEqual([
      { type: "save-recorder", recorder: "new-recorder" },
      { type: "remember-recorder-choice", recorder: "new-recorder" },
    ]);
  });

  it("a locked choice does not change", () => {
    const { state, effects } = run(landscape("obs"), {
      type: "recorder-picked",
      recorder: "new-recorder",
      locked: true,
    });
    expect(state.recorder).toBe("obs");
    expect(effects).toEqual([]);
  });

  it("a Short offers OBS only and never takes the New recorder", () => {
    const short = createInitialRecorderChoiceState({
      format: "short",
      recorder: "new-recorder",
    });
    expect(short.options).toEqual(["obs"]);
    expect(short.recorder).toBe("obs");
    const { state, effects } = run(short, {
      type: "recorder-picked",
      recorder: "new-recorder",
      locked: false,
    });
    expect(state.recorder).toBe("obs");
    expect(effects).toEqual([]);
  });

  it("a failed save goes back to the saved Recorder and says why", () => {
    const { state } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "new-recorder", locked: false },
      {
        type: "recorder-save-failed",
        recorder: "new-recorder",
        message: "The Recorder is locked once the Video has Clips",
      }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBe("The Recorder is locked once the Video has Clips");
  });

  it("a stale failure after a newer pick changes nothing", () => {
    const { state } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "new-recorder", locked: false },
      { type: "recorder-picked", recorder: "obs", locked: false },
      { type: "recorder-save-failed", recorder: "new-recorder", message: "x" }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBeNull();
  });
});

describe("isRecorderLocked", () => {
  it("is unlocked on a Video with no Clips", () => {
    expect(isRecorderLocked(notRunning, [chapter], [])).toBe(false);
  });

  it("locks once the Video has a Clip", () => {
    expect(isRecorderLocked(notRunning, [chapter, clip], [])).toBe(true);
  });

  it("locks while OBS is recording, before any Clip lands", () => {
    expect(isRecorderLocked(recording, [], [])).toBe(true);
  });
});
