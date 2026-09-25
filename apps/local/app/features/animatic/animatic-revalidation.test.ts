import { describe, expect, it } from "vitest";
import { animaticMockupsSignature } from "./animatic-revalidation";
import type { AnimaticClipMockup } from "./animatic-timeline";

const mockup = (
  overrides: Partial<AnimaticClipMockup> = {}
): AnimaticClipMockup => ({
  id: "cm_1",
  line: "Here is the steering map.",
  position: 1,
  durationSeconds: 3.2,
  imageUrl: "/clip-mockups/cm_1/frame",
  audioUrl: "/clip-mockups/cm_1/audio",
  imageMissing: false,
  audioMissing: false,
  ...overrides,
});

describe("animaticMockupsSignature", () => {
  it("is the same for rows that say the same thing in new objects", () => {
    expect(animaticMockupsSignature([mockup()])).toBe(
      animaticMockupsSignature([mockup()])
    );
  });

  it("changes when a line is rewritten", () => {
    expect(animaticMockupsSignature([mockup({ line: "Rewritten." })])).not.toBe(
      animaticMockupsSignature([mockup()])
    );
  });

  it("changes when speech gets longer, because the timeline moves", () => {
    expect(
      animaticMockupsSignature([mockup({ durationSeconds: 4.1 })])
    ).not.toBe(animaticMockupsSignature([mockup()]));
  });

  it("changes when a missing file appears on disk", () => {
    expect(animaticMockupsSignature([mockup({ imageMissing: true })])).not.toBe(
      animaticMockupsSignature([mockup()])
    );
  });

  it("changes when a Clip Mockup is added", () => {
    expect(
      animaticMockupsSignature([mockup(), mockup({ id: "cm_2", position: 2 })])
    ).not.toBe(animaticMockupsSignature([mockup()]));
  });

  it("changes when two Clip Mockups swap places", () => {
    const first = mockup();
    const second = mockup({ id: "cm_2", position: 2 });
    expect(animaticMockupsSignature([first, second])).not.toBe(
      animaticMockupsSignature([
        { ...second, position: 1 },
        { ...first, position: 2 },
      ])
    );
  });
});
