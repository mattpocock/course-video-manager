import { describe, expect, it } from "vitest";
import { unlistOfEndStreamAnswer } from "./route-answer";

describe("End Stream's answer from the app server", () => {
  it("reads how the unlist went", () => {
    expect(
      unlistOfEndStreamAnswer({ ok: true, unlist: { status: "unlisted" } })
    ).toEqual({ status: "unlisted" });
    expect(
      unlistOfEndStreamAnswer({
        ok: true,
        unlist: { status: "failed", message: "quota" },
      })
    ).toEqual({ status: "failed", message: "quota" });
  });

  it("refuses a malformed answer with a clear reason", () => {
    expect(() => unlistOfEndStreamAnswer({ ok: true })).toThrow(
      "The stream ended, but CVM could not read whether the Broadcast was unlisted."
    );
    expect(() =>
      unlistOfEndStreamAnswer({ unlist: { status: "deleted" } })
    ).toThrow(/could not read whether the Broadcast was unlisted/);
  });
});
