import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBILITY,
  resolveEffectiveVisibility,
  VISIBILITY_TREE,
  type VisibilityKey,
} from "./course-view-visibility";

describe("resolveEffectiveVisibility", () => {
  it("1. is fully visible under the default preferences, except Beat Descriptions", () => {
    const effective = resolveEffectiveVisibility(DEFAULT_VISIBILITY);
    for (const node of VISIBILITY_TREE) {
      if (node.key === "beatDescriptions") continue;
      expect(effective[node.key]).toBe(true);
    }
    expect(effective.beatDescriptions).toBe(false);
  });

  it("2. hides a child whose own preference is off, without touching siblings", () => {
    const prefs = { ...DEFAULT_VISIBILITY, lessonPriorities: false };
    const effective = resolveEffectiveVisibility(prefs);
    expect(effective.lessonPriorities).toBe(false);
    expect(effective.lessonTypes).toBe(true);
    expect(effective.lessons).toBe(true);
  });

  it("3. cascades a hidden parent down to every descendant", () => {
    const prefs = { ...DEFAULT_VISIBILITY, lessons: false };
    const effective = resolveEffectiveVisibility(prefs);
    expect(effective.lessons).toBe(false);
    expect(effective.lessonDescriptions).toBe(false);
    expect(effective.lessonPriorities).toBe(false);
    expect(effective.lessonTypes).toBe(false);
    expect(effective.todoMarkers).toBe(false);
    expect(effective.dependencies).toBe(false);
    expect(effective.videos).toBe(false);
    // Two levels down (Beats is a child of Videos, which is a child of
    // Lessons) — the cascade has to walk the whole ancestor chain, not just
    // the immediate parent.
    expect(effective.beats).toBe(false);
    expect(effective.beatDescriptions).toBe(false);
    expect(effective.addBeatButton).toBe(false);
  });

  it("4. leaves an unrelated branch alone when a sibling subtree is hidden", () => {
    const prefs = { ...DEFAULT_VISIBILITY, lessons: false };
    const effective = resolveEffectiveVisibility(prefs);
    expect(effective.learningGoals).toBe(true);
    expect(effective.learningGoalDescriptions).toBe(true);
    expect(effective.sectionDescriptions).toBe(true);
  });

  it("5. keeps a child's own preference intact for when its parent comes back on", () => {
    // Turning a parent off and back on shouldn't clobber a child's own
    // stored preference — resolveEffectiveVisibility only reads `prefs`, so
    // this documents that the parent flag alone decides the cascade.
    const childOff = {
      ...DEFAULT_VISIBILITY,
      videos: false,
      beats: false,
    };
    expect(resolveEffectiveVisibility(childOff).beats).toBe(false);

    const parentBackOn = { ...childOff, videos: true };
    expect(resolveEffectiveVisibility(parentBackOn).beats).toBe(false);
    expect(resolveEffectiveVisibility(parentBackOn).videos).toBe(true);
  });

  it("6. every VISIBILITY_TREE key round-trips through the cascade", () => {
    const effective = resolveEffectiveVisibility(DEFAULT_VISIBILITY);
    const keys = VISIBILITY_TREE.map((n) => n.key);
    const uniqueKeys = new Set<VisibilityKey>(keys);
    expect(uniqueKeys.size).toBe(keys.length);
    for (const key of keys) {
      expect(effective).toHaveProperty(key);
    }
  });
});
