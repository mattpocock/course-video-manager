import { describe, expect, it } from "vitest";
import {
  WRITER_URL_UPDATE,
  applyWriterUrlState,
  readWriterUrlState,
} from "./writer-url-state";

const params = (init: string) => new URLSearchParams(init);

describe("writer URL state", () => {
  it("keeps the page where it was when the writer state changes", () => {
    // Pages scroll at the document level, so React Router treats every writer
    // URL update as a location it has no saved scroll position for and sends
    // the page to the top. Applying the writer's document closes it, which is
    // how a save ended up scrolling the page back to the top (#1485).
    expect(WRITER_URL_UPDATE.preventScrollReset).toBe(true);
  });

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
    });

    expect(readWriterUrlState(reopened, "video-body")).toEqual({
      view: "writer",
      ctxTab: undefined,
    });
  });

  it("leaves the host page's own search params untouched", () => {
    const opened = applyWriterUrlState(params("versionId=v1"), "video-body", {
      view: "settings",
    });
    const closed = applyWriterUrlState(opened, "video-body", null);

    expect(closed.toString()).toBe("versionId=v1");
  });
});
