import { describe, expect, it } from "vitest";
import { parseEntityRef } from "@/features/entity-links/entity-deep-link";
import { goToUrl } from "./go-to-url";

/** Where "go to" on a diagram search result opens it. */
describe("goToUrl", () => {
  it("opens a DiagramSnapshot hit's Diagram with the snapshot highlighted", () => {
    expect(
      goToUrl({
        source: "snapshot",
        diagramId: "d 1",
        highlightSnapshotId: "s1",
      })
    ).toBe("/diagram-playground/d%201?highlight=s1");
  });

  it("opens a Diagram's head with nothing highlighted", () => {
    expect(
      goToUrl({ source: "current", diagramId: "d1", highlightSnapshotId: null })
    ).toBe("/diagram-playground/d1");
  });

  it("still reads back as the Diagram's own link", () => {
    const url = goToUrl({
      source: "snapshot",
      diagramId: "d1",
      highlightSnapshotId: "s1",
    });
    expect(parseEntityRef(`http://localhost${url}`)).toEqual({
      type: "diagram",
      id: "d1",
    });
  });

  it("opens a Thumbnail Diagram hit's Thumbnail in the thumbnail creator", () => {
    expect(
      goToUrl({ source: "thumbnail-diagram", thumbnailId: "t1", videoId: "v1" })
    ).toBe("/videos/v1/thumbnails?thumbnail=t1");
  });
});
