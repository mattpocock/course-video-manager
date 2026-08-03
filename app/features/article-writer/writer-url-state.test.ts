import { describe, expect, it } from "vitest";
import { applyWriterUrlState, readWriterUrlState } from "./writer-url-state";

const params = (init: string) => new URLSearchParams(init);

describe("writer URL state", () => {
  it("reads another field's open writer as closed", () => {
    expect(
      readWriterUrlState(params("writer=video-body"), "video-description")
    ).toBeNull();
  });

  it("restores the view and context tab an open writer was left on", () => {
    const opened = applyWriterUrlState(params(""), "video-body", {
      view: "context",
      ctxTab: "files",
    });

    expect(readWriterUrlState(opened, "video-body")).toEqual({
      view: "context",
      ctxTab: "files",
    });
  });

  it("reopens on the writer view after a close from the context panel", () => {
    const opened = applyWriterUrlState(params(""), "video-body", {
      view: "context",
      ctxTab: "files",
    });
    const closed = applyWriterUrlState(opened, "video-body", null);
    const reopened = applyWriterUrlState(closed, "video-body", {
      view: "writer",
      ctxTab: undefined,
    });

    expect(readWriterUrlState(reopened, "video-body")).toEqual({
      view: "writer",
      ctxTab: undefined,
    });
  });

  it("leaves the host page's own search params untouched", () => {
    const opened = applyWriterUrlState(params("versionId=v1"), "video-body", {
      view: "settings",
      ctxTab: undefined,
    });
    const closed = applyWriterUrlState(opened, "video-body", null);

    expect(closed.toString()).toBe("versionId=v1");
  });

  it("keeps every value of a repeated host param when the writer opens", () => {
    const opened = applyWriterUrlState(params("tag=a&tag=b"), "video-body", {
      view: "writer",
      ctxTab: undefined,
    });

    expect(opened.getAll("tag")).toEqual(["a", "b"]);
  });

  it("falls back to the writer view for a hand-edited writerView", () => {
    const state = readWriterUrlState(
      params("writer=video-body&writerView=bogus"),
      "video-body"
    );

    expect(state).toEqual({ view: "writer", ctxTab: undefined });
  });

  it("hands the writer over to another field without leaking the old sub-view", () => {
    const bodyOpen = applyWriterUrlState(params(""), "video-body", {
      view: "context",
      ctxTab: "files",
    });
    const descriptionOpen = applyWriterUrlState(bodyOpen, "video-description", {
      view: "writer",
      ctxTab: undefined,
    });

    expect(readWriterUrlState(descriptionOpen, "video-body")).toBeNull();
    expect(readWriterUrlState(descriptionOpen, "video-description")).toEqual({
      view: "writer",
      ctxTab: undefined,
    });
  });
});
