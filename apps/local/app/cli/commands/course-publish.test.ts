import { describe, it, expect } from "vitest";
import { isValidPublishVersionName } from "./course-publish";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
  placeholderFloorFromBand,
} from "@/cli/placeholder-floor";

describe("isValidPublishVersionName", () => {
  it.each([
    "v0.0.0",
    "v1.0.0",
    "v1.2.3",
    "v10.20.30",
    "v1.0.0-beta",
    "v1.0.0-beta.1",
    "v2.0.0-rc.2",
    "v1.0.0-alpha.1+build.5",
    "v1.0.0+20260714",
  ])("accepts the lowercase-'v' semver %s", (name) => {
    expect(isValidPublishVersionName(name)).toBe(true);
  });

  it.each([
    "1.0.0", // missing the v prefix
    "V1.0.0", // uppercase V
    "v1.0", // not a full major.minor.patch
    "v1", // not a full semver
    "v1.2.3.4", // too many segments
    "version-1", // not semver
    "v01.0.0", // leading zero in a numeric identifier
    "", // empty
    " v1.0.0", // surrounding whitespace
    "v1.0.0 ", // trailing whitespace
    "vabc", // not numeric
  ])("rejects %s", (name) => {
    expect(isValidPublishVersionName(name)).toBe(false);
  });
});

// The Placeholder Floor `cvm course publish` ships a release at. The band
// spellings and their meaning are shared with `cvm course readiness` through
// @/cli/placeholder-floor, so these cases pin the seam BOTH verbs read: the
// same band must always name the same floor, and an omitted flag must be the
// announce-nothing position — today's behaviour exactly.
describe("the Placeholder Floor as a --placeholders band", () => {
  it.each([
    ["none", null], // announce nothing — no Lesson ships as a Placeholder Lesson
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
  ] as const)("reads the band %s as the floor %s", (band, floor) => {
    expect(placeholderFloorFromBand(band)).toBe(floor);
  });

  it("accepts exactly the four bands, in floor order", () => {
    expect(PLACEHOLDER_FLOOR_BANDS).toEqual(["none", "p1", "p2", "p3"]);
  });

  it("defaults to announcing nothing, so omitting the flag publishes as it did before", () => {
    expect(ANNOUNCE_NOTHING_BAND).toBe("none");
    expect(placeholderFloorFromBand(ANNOUNCE_NOTHING_BAND)).toBe(null);
  });
});
