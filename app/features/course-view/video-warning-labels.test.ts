import { describe, it, expect } from "vitest";
import {
  VIDEO_WARNING_LABELS,
  videoWarningLabel,
} from "./video-warning-labels";

describe("videoWarningLabel", () => {
  it("labels the missing-chapters warning", () => {
    expect(VIDEO_WARNING_LABELS.missingChapters).toBe("Missing chapters");
  });

  it("joins every warning it is given", () => {
    expect(
      videoWarningLabel([{ kind: "missingChapters" }, { kind: "missingBody" }])
    ).toBe("Missing chapters · Missing lesson body");
  });
});
