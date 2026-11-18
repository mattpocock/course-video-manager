import { describe, it, expect } from "vitest";
import {
  mergeThumbnailDiagramSources,
  readThumbnailDiagramSources,
} from "./thumbnail-diagram-sources.js";

describe("readThumbnailDiagramSources", () => {
  it("reads each kind of source", () => {
    expect(
      readThumbnailDiagramSources([
        { kind: "diagram-component", diagramComponentId: "c1" },
        { kind: "diagram-snapshot", diagramSnapshotId: "s1" },
        { kind: "thumbnail-diagram", thumbnailId: "t1" },
      ])
    ).toEqual([
      { kind: "diagram-component", diagramComponentId: "c1" },
      { kind: "diagram-snapshot", diagramSnapshotId: "s1" },
      { kind: "thumbnail-diagram", thumbnailId: "t1" },
    ]);
  });

  it("reads a missing field as no sources", () => {
    expect(readThumbnailDiagramSources(undefined)).toEqual([]);
  });

  it("drops fields a source doesn't have", () => {
    expect(
      readThumbnailDiagramSources([
        { kind: "diagram-snapshot", diagramSnapshotId: "s1", extra: 1 },
      ])
    ).toEqual([{ kind: "diagram-snapshot", diagramSnapshotId: "s1" }]);
  });

  it.each([
    ["not a list", { kind: "diagram-snapshot", diagramSnapshotId: "s1" }],
    ["an unknown kind", [{ kind: "diagram", diagramId: "d1" }]],
    ["a missing id", [{ kind: "diagram-component" }]],
    ["an empty id", [{ kind: "thumbnail-diagram", thumbnailId: "" }]],
  ])("refuses %s", (_name, value) => {
    expect(readThumbnailDiagramSources(value)).toBeUndefined();
  });
});

describe("mergeThumbnailDiagramSources", () => {
  it("keeps every recorded source once, in the order first recorded", () => {
    expect(
      mergeThumbnailDiagramSources(
        [
          { kind: "diagram-snapshot", diagramSnapshotId: "s1" },
          { kind: "diagram-component", diagramComponentId: "c1" },
        ],
        [
          { kind: "diagram-component", diagramComponentId: "c1" },
          { kind: "thumbnail-diagram", thumbnailId: "t1" },
          { kind: "thumbnail-diagram", thumbnailId: "t1" },
        ]
      )
    ).toEqual([
      { kind: "diagram-snapshot", diagramSnapshotId: "s1" },
      { kind: "diagram-component", diagramComponentId: "c1" },
      { kind: "thumbnail-diagram", thumbnailId: "t1" },
    ]);
  });

  it("tells a component and a snapshot with the same id apart", () => {
    expect(
      mergeThumbnailDiagramSources(
        [{ kind: "diagram-component", diagramComponentId: "x" }],
        [{ kind: "diagram-snapshot", diagramSnapshotId: "x" }]
      )
    ).toHaveLength(2);
  });
});
