import { describe, expect, it } from "vitest";
import {
  createInitialRecorderChoiceState,
  recorderChoiceReducer,
  showsCvmRecorderControls,
  showsOBSChecks,
} from "./recorder-choice-reducer";

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

describe("recorder choice", () => {
  it("every existing Video reads as OBS and shows the OBS checks", () => {
    const state = landscape(null);
    expect(state.recorder).toBe("obs");
    expect(showsOBSChecks(state)).toBe(true);
    expect(showsCvmRecorderControls(state)).toBe(false);
  });

  it("picking the CVM recorder saves it, hides the OBS checks, and remembers it as the last choice once saved", () => {
    const picked = run(landscape(), {
      type: "recorder-picked",
      recorder: "cvm",
      capturing: false,
    });
    expect(picked.state.recorder).toBe("cvm");
    expect(showsOBSChecks(picked.state)).toBe(false);
    // The CVM recorder's status and the composite preview.
    expect(showsCvmRecorderControls(picked.state)).toBe(true);
    expect(picked.effects).toEqual([
      { type: "save-recorder", recorder: "cvm" },
    ]);
    const saved = run(picked.state, {
      type: "recorder-saved",
      recorder: "cvm",
    });
    expect(saved.effects).toEqual([
      { type: "remember-recorder-choice", recorder: "cvm" },
    ]);
  });

  it("a pick mid-capture does not change the Recorder", () => {
    const { state, effects } = run(landscape("obs"), {
      type: "recorder-picked",
      recorder: "cvm",
      capturing: true,
    });
    expect(state.recorder).toBe("obs");
    expect(effects).toEqual([]);
  });

  it("a Short offers the CVM recorder only, whatever it stored", () => {
    const short = createInitialRecorderChoiceState({
      format: "short",
      recorder: "obs",
    });
    expect(short.options).toEqual(["cvm"]);
    expect(short.recorder).toBe("cvm");
    const { state, effects } = run(short, {
      type: "recorder-picked",
      recorder: "obs",
      capturing: false,
    });
    expect(state.recorder).toBe("cvm");
    expect(effects).toEqual([]);
  });

  it("a failed save goes back to the saved Recorder, says why and is not remembered", () => {
    const { state, effects } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "cvm", capturing: false },
      {
        type: "recorder-save-failed",
        recorder: "cvm",
        message: "The Recorder is locked while the Video is recording",
      }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBe(
      "The Recorder is locked while the Video is recording"
    );
    expect(effects).not.toContainEqual(
      expect.objectContaining({ type: "remember-recorder-choice" })
    );
  });

  it("a stale failure after a newer pick changes nothing", () => {
    const { state } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "cvm", capturing: false },
      { type: "recorder-picked", recorder: "obs", capturing: false },
      { type: "recorder-save-failed", recorder: "cvm", message: "x" }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBeNull();
  });
});
