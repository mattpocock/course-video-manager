/**
 * ADR 0023, amended by ADR 0029. Every input the Bundle address is computed
 * over is named here once, so a new one cannot be added without a test saying
 * what it changes. Two releases of one CourseVersion that ship different bytes
 * must never land at one address.
 */

import { describe, it, expect } from "vitest";
import { computeBundleAddress } from "./course-publish-bundle-address";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";

const base = {
  schemaJson: '{"schemaVersion":4}',
  courseId: "course-1",
  courseVersionId: "version-1",
  courseName: "Test Course",
  includeTodoLessons: true,
  placeholderFloor: ANNOUNCE_NOTHING,
  sections: [{ path: "01-intro" }],
  videos: [
    { relativeAssetPath: "01-intro/01.01-a/Explainer.mp4", exportHash: "h1" },
  ],
};

const addressOf = (overrides: Partial<typeof base> = {}) =>
  computeBundleAddress({ ...base, ...overrides }).assetBasePath;

describe("computeBundleAddress", () => {
  it("re-addresses the bundle when the Placeholder Floor moves", () => {
    const addresses = new Set(
      [ANNOUNCE_NOTHING, 1, 2, 3].map((floor) =>
        addressOf({ placeholderFloor: floor as 1 | 2 | 3 | null })
      )
    );
    expect(addresses.size).toBe(4);
  });

  it("keeps the floor and the to-do setting apart", () => {
    // Belt and braces: neither control may stand in for the other.
    expect(addressOf({ placeholderFloor: 1 })).not.toBe(
      addressOf({ includeTodoLessons: false })
    );
  });

  it("gives the same address for the same recipe", () => {
    expect(addressOf()).toBe(addressOf());
  });

  it("re-addresses the bundle when the manifest schema changes", () => {
    // Why the first v4 Publish of each Course re-uploads every .mp4 once.
    expect(addressOf()).not.toBe(
      addressOf({ schemaJson: '{"schemaVersion":3}' })
    );
  });

  it("addresses a release that ships no videos at all", () => {
    const address = addressOf({ videos: [] });
    expect(address).toMatch(/^versions\/[a-f0-9]{16}-[a-f0-9]{32}$/);
    expect(address).not.toBe(addressOf());
  });

  it("keeps the version fingerprint stable across asset changes", () => {
    const [aVersion] = addressOf().split("-");
    const [bVersion] = addressOf({ videos: [] }).split("-");
    expect(aVersion).toBe(bVersion);
  });
});
