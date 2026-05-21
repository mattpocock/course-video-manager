import { describe, it, expect } from "vitest";
import { pitchBackLink } from "./pitch-back-link";

describe("pitchBackLink", () => {
  it("returns root path when from=deliverables", () => {
    expect(pitchBackLink("deliverables")).toEqual({
      href: "/",
      label: "Back to Deliverables",
    });
  });

  it("returns /pitches when from is null", () => {
    expect(pitchBackLink(null)).toEqual({
      href: "/pitches",
      label: "Back to Pitches",
    });
  });

  it("returns /pitches for unknown from values", () => {
    expect(pitchBackLink("unknown")).toEqual({
      href: "/pitches",
      label: "Back to Pitches",
    });
  });
});
