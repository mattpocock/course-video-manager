import { describe, expect, it } from "vitest";
import { resolveBeatTab } from "./beat-tab";

describe("resolveBeatTab", () => {
  it("honours a persisted tab that still exists (beats)", () => {
    expect(
      resolveBeatTab({
        persistedTab: "beats",
        hasBeats: true,
        hasReference: true,
      })
    ).toBe("beats");
  });

  it("honours a persisted tab that still exists (reference)", () => {
    expect(
      resolveBeatTab({
        persistedTab: "reference",
        hasBeats: true,
        hasReference: true,
      })
    ).toBe("reference");
  });

  it("falls back to script when the persisted tab no longer exists (reference removed)", () => {
    expect(
      resolveBeatTab({
        persistedTab: "reference",
        hasBeats: true,
        hasReference: false,
      })
    ).toBe("script");
  });

  it("falls back to script when the persisted tab no longer exists (beats gone)", () => {
    expect(
      resolveBeatTab({
        persistedTab: "beats",
        hasBeats: false,
        hasReference: true,
      })
    ).toBe("script");
  });

  it("defaults to script even when a reference is selected", () => {
    expect(
      resolveBeatTab({
        persistedTab: null,
        hasBeats: true,
        hasReference: true,
      })
    ).toBe("script");
  });

  it("defaults to script even when the video has beats", () => {
    expect(
      resolveBeatTab({
        persistedTab: null,
        hasBeats: true,
        hasReference: false,
      })
    ).toBe("script");
  });

  it("falls back to script when neither beats nor reference is available", () => {
    expect(
      resolveBeatTab({
        persistedTab: null,
        hasBeats: false,
        hasReference: false,
      })
    ).toBe("script");
  });

  it("falls back to script when a stale beats tab was persisted and neither exists", () => {
    expect(
      resolveBeatTab({
        persistedTab: "beats",
        hasBeats: false,
        hasReference: false,
      })
    ).toBe("script");
  });

  it("honours a persisted script tab (always available)", () => {
    expect(
      resolveBeatTab({
        persistedTab: "script",
        hasBeats: true,
        hasReference: true,
      })
    ).toBe("script");
  });
});
