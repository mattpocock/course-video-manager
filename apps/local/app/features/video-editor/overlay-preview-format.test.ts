import { describe, expect, it } from "vitest";
import {
  findActiveOverlays,
  landscapeOverlaysByClipId,
  shortOverlaysByClipId,
  type ClipOverlay,
} from "./overlay-preview";

// Which Overlays each editor preview draws: a Short only its Chat Cards and
// Calls to Action, as its render does; every other Video everything BUT
// those, as its export drops them. All chat is fake.

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
});

const byClip = new Map([
  [
    "clip_1",
    [overlay("ovl_def", "definitionCard"), overlay("ovl_chat", "chatCard")],
  ],
  ["clip_2", [overlay("ovl_chat_only", "chatCard")]],
  ["clip_3", [overlay("ovl_panel", "bulletPanel")]],
  ["clip_4", [overlay("ovl_cta", "callToAction")]],
]);

const ids = (m: Map<string, ClipOverlay[]>) =>
  Object.fromEntries([...m].map(([clipId, o]) => [clipId, o.map((x) => x.id)]));

describe("the Overlays an editor preview draws", () => {
  it("in a Short: its Chat Cards and Calls to Action only", () => {
    expect(ids(shortOverlaysByClipId(byClip))).toEqual({
      clip_1: ["ovl_chat"],
      clip_2: ["ovl_chat_only"],
      clip_4: ["ovl_cta"],
    });
  });

  it("in any other Video: everything but its Chat Cards and Calls to Action", () => {
    expect(ids(landscapeOverlaysByClipId(byClip))).toEqual({
      clip_1: ["ovl_def"],
      clip_3: ["ovl_panel"],
    });
  });
});

describe("the Overlays the playing preview draws at a moment", () => {
  const at = (o: ClipOverlay, start: number) => ({ ...o, at: start });

  it("draws a Call to Action and a Chat Card together", () => {
    const overlays = [
      overlay("ovl_chat", "chatCard"),
      at(overlay("ovl_cta", "callToAction"), 2),
    ];

    expect(findActiveOverlays(overlays, 3).map((o) => o.id)).toEqual([
      "ovl_chat",
      "ovl_cta",
    ]);
  });

  it("draws only the later of any other two that overlap", () => {
    const overlays = [
      overlay("ovl_def", "definitionCard"),
      at(overlay("ovl_cta", "callToAction"), 2),
    ];

    expect(findActiveOverlays(overlays, 3).map((o) => o.id)).toEqual([
      "ovl_cta",
    ]);
  });
});
