import { describe, it, expect } from "vitest";
import { parseSemver, bumpSemver } from "./semver";

describe("parseSemver", () => {
  it("parses a v-prefixed semver string", () => {
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses without v prefix", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses v0.0.0", () => {
    expect(parseSemver("v0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("parses uppercase V prefix", () => {
    expect(parseSemver("V2.0.1")).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it("returns null for non-semver strings", () => {
    expect(parseSemver("hello")).toBeNull();
    expect(parseSemver("v1.2")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("v1.2.3.4")).toBeNull();
  });

  it("returns null for semver with extra text", () => {
    expect(parseSemver("v1.2.3-beta")).toBeNull();
    expect(parseSemver("v1.2.3 -- Added auth")).toBeNull();
  });
});

describe("bumpSemver", () => {
  it("bumps patch", () => {
    expect(bumpSemver({ major: 1, minor: 2, patch: 3 }, "patch")).toEqual({
      major: 1,
      minor: 2,
      patch: 4,
    });
  });

  it("bumps minor and resets patch", () => {
    expect(bumpSemver({ major: 1, minor: 2, patch: 3 }, "minor")).toEqual({
      major: 1,
      minor: 3,
      patch: 0,
    });
  });

  it("bumps major and resets minor and patch", () => {
    expect(bumpSemver({ major: 1, minor: 2, patch: 3 }, "major")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    });
  });

  it("bumps from v0.0.0", () => {
    expect(bumpSemver({ major: 0, minor: 0, patch: 0 }, "patch")).toEqual({
      major: 0,
      minor: 0,
      patch: 1,
    });
    expect(bumpSemver({ major: 0, minor: 0, patch: 0 }, "minor")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
    });
    expect(bumpSemver({ major: 0, minor: 0, patch: 0 }, "major")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
    });
  });
});
