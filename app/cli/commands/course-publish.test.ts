import { describe, it, expect } from "vitest";
import { isValidPublishVersionName } from "./course-publish";

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
