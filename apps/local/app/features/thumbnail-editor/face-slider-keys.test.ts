import { describe, expect, it } from "vitest";
import { faceSliderKeyCommand } from "./face-slider-keys";

/**
 * The face slider's keys. The face is on the editor's one undo history, so
 * Cmd+Z in the slider undoes there, unless tldraw already took the key.
 */

const key = (
  k: string,
  mods: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
  }> = {}
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...mods,
});

describe("faceSliderKeyCommand", () => {
  it("forwards Cmd+Z and Ctrl+Z to the editor's undo", () => {
    expect(faceSliderKeyCommand(key("z", { metaKey: true }))).toEqual({
      command: "undo",
    });
    expect(faceSliderKeyCommand(key("Z", { ctrlKey: true }))).toEqual({
      command: "undo",
    });
  });

  it("forwards Cmd+Shift+Z to the editor's redo", () => {
    expect(
      faceSliderKeyCommand(key("Z", { metaKey: true, shiftKey: true }))
    ).toEqual({ command: "redo" });
  });

  it("leaves a Cmd+Z tldraw already ran alone, so it is not undone twice", () => {
    expect(
      faceSliderKeyCommand(key("z", { metaKey: true, defaultPrevented: true }))
    ).toBeNull();
  });

  it("nudges the face with the arrows, further with Shift", () => {
    expect(faceSliderKeyCommand(key("ArrowLeft"))).toEqual({
      command: "nudge",
      direction: -1,
      big: false,
    });
    expect(faceSliderKeyCommand(key("ArrowRight", { shiftKey: true }))).toEqual(
      { command: "nudge", direction: 1, big: true }
    );
  });

  it("leaves every other key to the slider", () => {
    expect(faceSliderKeyCommand(key("z"))).toBeNull();
    expect(faceSliderKeyCommand(key("Home"))).toBeNull();
  });
});
