import { describe, it, expect } from "vitest";
import { postSubTabs } from "./post-sub-tabs";

const labels = (isStandalone: boolean) =>
  postSubTabs({ isStandalone }).map((tab) => `${tab.label}:${tab.path}`);

describe("postSubTabs", () => {
  it("opens a lesson-bound Video's Body under Lesson", () => {
    expect(labels(false)).toEqual([
      "Lesson:lesson",
      "YouTube:post",
      "X / LinkedIn:social",
      "AI Hero:ai-hero",
      "Skills Changelog:skills-changelog",
      "Newsletter:newsletter",
    ]);
  });

  it("opens a Standalone Video's Body under Article", () => {
    expect(labels(true)).toEqual([
      "Article:lesson",
      "YouTube:post",
      "X / LinkedIn:social",
      "AI Hero:ai-hero",
      "Skills Changelog:skills-changelog",
      "Newsletter:newsletter",
    ]);
  });
});
