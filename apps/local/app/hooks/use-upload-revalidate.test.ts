import { describe, expect, it } from "vitest";
import type { uploadReducer } from "@/features/upload-manager/upload-reducer";
import { hasNewSuccessForTypes } from "./use-upload-revalidate";

function entry(
  status: uploadReducer.UploadStatus,
  uploadType: uploadReducer.UploadType
) {
  return { status, uploadType };
}

describe("hasNewSuccessForTypes", () => {
  it("returns true when a matching upload type transitions to success", () => {
    const prev = { "upload-1": entry("uploading", "buffer") };
    const current = { "upload-1": entry("success", "buffer") };
    expect(hasNewSuccessForTypes(prev, current, new Set(["buffer"]))).toBe(
      true
    );
  });

  it("returns false when a non-matching upload type transitions to success", () => {
    const prev = { "upload-1": entry("uploading", "youtube") };
    const current = { "upload-1": entry("success", "youtube") };
    expect(hasNewSuccessForTypes(prev, current, new Set(["buffer"]))).toBe(
      false
    );
  });

  it("returns false when status has not changed", () => {
    const prev = { "upload-1": entry("uploading", "buffer") };
    const current = { "upload-1": entry("uploading", "buffer") };
    expect(hasNewSuccessForTypes(prev, current, new Set(["buffer"]))).toBe(
      false
    );
  });

  it("returns false when upload is new (not in prev)", () => {
    const prev = {};
    const current = { "upload-1": entry("success", "buffer") };
    expect(hasNewSuccessForTypes(prev, current, new Set(["buffer"]))).toBe(
      false
    );
  });

  it("returns true when any one of multiple uploads matches", () => {
    const prev = {
      "upload-1": entry("uploading", "youtube"),
      "upload-2": entry("uploading", "youtube-shorts"),
    };
    const current = {
      "upload-1": entry("uploading", "youtube"),
      "upload-2": entry("success", "youtube-shorts"),
    };
    expect(
      hasNewSuccessForTypes(prev, current, new Set(["youtube-shorts"]))
    ).toBe(true);
  });

  it("returns false when upload transitions to error instead of success", () => {
    const prev = { "upload-1": entry("uploading", "buffer") };
    const current = { "upload-1": entry("error", "buffer") };
    expect(hasNewSuccessForTypes(prev, current, new Set(["buffer"]))).toBe(
      false
    );
  });

  it("checks multiple types in the set", () => {
    const prev = { "upload-1": entry("uploading", "render-vertical") };
    const current = { "upload-1": entry("success", "render-vertical") };
    expect(
      hasNewSuccessForTypes(
        prev,
        current,
        new Set(["buffer", "youtube-shorts", "render-vertical", "export"])
      )
    ).toBe(true);
  });
});
