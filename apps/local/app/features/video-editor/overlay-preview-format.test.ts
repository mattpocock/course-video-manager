import { describe, expect, it } from "vitest";
import {
  landscapeOverlaysByClipId,
  shortOverlaysByClipId,
  type ClipOverlay,
} from "./overlay-preview";

// Which Overlays each editor preview draws: a Short only its Chat Cards, as
// its render does; every other Video everything BUT Chat Cards, as its export
// drops them. All chat is fake.

const overlay = (id: string, kind: string): ClipOverlay => ({
  id,
  clipId: "clip_1",
  at: 0,
  durationInSeconds: 4,
  kind,
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "@fake_viewer_1",
  description: "A fake question?",
  bullets: null,
  chatSpin: kind === "chatCard" ? [] : null,
});

const byClip = new Map([
  [
    "clip_1",
    [overlay("ovl_def", "definitionCard"), overlay("ovl_chat", "chatCard")],
  ],
  ["clip_2", [overlay("ovl_chat_only", "chatCard")]],
  ["clip_3", [overlay("ovl_panel", "bulletPanel")]],
]);

const ids = (m: Map<string, ClipOverlay[]>) =>
  Object.fromEntries([...m].map(([clipId, o]) => [clipId, o.map((x) => x.id)]));

describe("the Overlays an editor preview draws", () => {
  it("in a Short: its Chat Cards only", () => {
    expect(ids(shortOverlaysByClipId(byClip))).toEqual({
      clip_1: ["ovl_chat"],
      clip_2: ["ovl_chat_only"],
    });
  });

  it("in any other Video: everything but its Chat Cards", () => {
    expect(ids(landscapeOverlaysByClipId(byClip))).toEqual({
      clip_1: ["ovl_def"],
      clip_3: ["ovl_panel"],
    });
  });
});
