import { CircleQuestionMark } from "lucide-react";
import { describe, expect, it } from "vitest";
import { SEGMENT_KIND_ICONS } from "./segment-kinds";

describe("SEGMENT_KIND_ICONS", () => {
  it("maps quest to CircleQuestionMark", () => {
    expect(SEGMENT_KIND_ICONS.quest).toBe(CircleQuestionMark);
  });
});
