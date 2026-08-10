import { describe, it, expect } from "vitest";
import { shouldSnapshot } from "./snapshot-rule";

describe("shouldSnapshot", () => {
  it("returns true when an active diagram is set and it was focused during the clip", () => {
    expect(
      shouldSnapshot({
        activeDiagramId: "diagram-1",
        diagramFocusedDuringClip: true,
      })
    ).toBe(true);
  });

  it("returns false when activeDiagramId is null", () => {
    expect(
      shouldSnapshot({
        activeDiagramId: null,
        diagramFocusedDuringClip: true,
      })
    ).toBe(false);
  });

  it("returns false when the diagram was not focused during the clip", () => {
    expect(
      shouldSnapshot({
        activeDiagramId: "diagram-1",
        diagramFocusedDuringClip: false,
      })
    ).toBe(false);
  });

  it("returns false when both signals are absent", () => {
    expect(
      shouldSnapshot({
        activeDiagramId: null,
        diagramFocusedDuringClip: false,
      })
    ).toBe(false);
  });

  it("treats empty string activeDiagramId as non-null", () => {
    expect(
      shouldSnapshot({
        activeDiagramId: "",
        diagramFocusedDuringClip: true,
      })
    ).toBe(true);
  });
});
