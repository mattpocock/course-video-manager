import { describe, expect, it } from "vitest";
import {
  animaticChaptersSignature,
  animaticMockupsSignature,
} from "./animatic-revalidation";
import type { AnimaticChapter } from "./animatic-chapters";
import type { AnimaticClipMockup } from "./animatic-timeline";

const mockup = (
  overrides: Partial<AnimaticClipMockup> = {}
): AnimaticClipMockup => ({
  id: "cm_1",
  line: "Here is the steering map.",
  position: 1,
  durationSeconds: 3.2,
  order: "a0",
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

const chapter = (
  overrides: Partial<AnimaticChapter> = {}
): AnimaticChapter => ({
  id: "cmc_1",
  name: "The setup",
  order: "a0",
  ...overrides,
});

describe("animaticChaptersSignature", () => {
  it("is the same for Chapters that say the same thing in new objects", () => {
    expect(animaticChaptersSignature([chapter()])).toBe(
      animaticChaptersSignature([chapter()])
    );
  });

  it("changes when a Chapter is renamed, so the poll shows the new title", () => {
    expect(
      animaticChaptersSignature([chapter({ name: "The payoff" })])
    ).not.toBe(animaticChaptersSignature([chapter()]));
  });

  it("changes when a Chapter is moved, because its rows change with it", () => {
    expect(animaticChaptersSignature([chapter({ order: "a5" })])).not.toBe(
      animaticChaptersSignature([chapter()])
    );
  });

  it("changes when a Chapter is added", () => {
    expect(
      animaticChaptersSignature([
        chapter(),
        chapter({ id: "cmc_2", order: "a1" }),
      ])
    ).not.toBe(animaticChaptersSignature([chapter()]));
  });
});
