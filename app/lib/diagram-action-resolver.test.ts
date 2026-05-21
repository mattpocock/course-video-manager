import { describe, it, expect } from "vitest";
import {
  resolveForClip,
  resolveForVideo,
  type ResolverTimelineItem,
  type SnapshotToDiagramId,
} from "./diagram-action-resolver";
import type { FrontendInsertionPoint } from "@/features/video-editor/clip-state-reducer.types";

const lookup: SnapshotToDiagramId = (snapshotId) => {
  const map: Record<string, string> = {
    "snap-1": "diagram-A",
    "snap-2": "diagram-B",
    "snap-3": "diagram-A",
  };
  return map[snapshotId] ?? null;
};

describe("resolveForClip", () => {
  it("returns diagram when clip has a resolvable diagramSnapshotId", () => {
    expect(resolveForClip({ diagramSnapshotId: "snap-1" }, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-A",
    });
  });

  it("returns home when clip diagramSnapshotId is null", () => {
    expect(resolveForClip({ diagramSnapshotId: null }, lookup)).toEqual({
      kind: "home",
    });
  });

  it("returns home when snapshot lookup returns null (deleted/unknown)", () => {
    expect(
      resolveForClip({ diagramSnapshotId: "snap-deleted" }, lookup)
    ).toEqual({ kind: "home" });
  });
});

describe("resolveForVideo", () => {
  function clip(
    frontendId: string,
    diagramSnapshotId: string | null = null
  ): ResolverTimelineItem {
    return { frontendId, kind: "clip", diagramSnapshotId };
  }

  function section(frontendId: string): ResolverTimelineItem {
    return { frontendId, kind: "chapter", diagramSnapshotId: null };
  }

  it("returns home when insertion point is start", () => {
    const items = [clip("c1", "snap-1")];
    const ip: FrontendInsertionPoint = { type: "start" };
    expect(resolveForVideo(items, ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns home when insertion point is end and all clips have no pin", () => {
    const items = [clip("c1"), clip("c2")];
    const ip: FrontendInsertionPoint = { type: "end" };
    expect(resolveForVideo(items, ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns the diagram of the clip at the insertion point when it has a pin", () => {
    const items = [clip("c1", "snap-1"), clip("c2", "snap-2")];
    const ip: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: "c1" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-A",
    });
  });

  it("walks backwards when the target clip has no pin but an earlier clip does", () => {
    const items = [clip("c1", "snap-2"), clip("c2"), clip("c3")];
    const ip: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: "c3" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-B",
    });
  });

  it("never returns a later clip's pin — only at-or-before the insertion point", () => {
    const items = [clip("c1", "snap-1"), clip("c2", "snap-2")];
    const ip: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: "c1" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-A",
    });
  });

  it("handles after-chapter by walking backwards from the section marker", () => {
    const items = [clip("c1", "snap-1"), section("s1"), clip("c2")];
    const ip: FrontendInsertionPoint = {
      type: "after-chapter",
      frontendChapterId: "s1" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-A",
    });
  });

  it("respects shared ordering space — mixed clips and sections", () => {
    const items = [
      clip("c1"),
      section("s1"),
      clip("c2", "snap-2"),
      section("s2"),
      clip("c3"),
    ];
    const ip: FrontendInsertionPoint = {
      type: "after-chapter",
      frontendChapterId: "s2" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-B",
    });
  });

  it("returns home when insertion point is end and items are empty", () => {
    const ip: FrontendInsertionPoint = { type: "end" };
    expect(resolveForVideo([], ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns home when after-clip target is not found in items", () => {
    const items = [clip("c1", "snap-1")];
    const ip: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: "nonexistent" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns nearest preceding pin's diagram (newest-first walk)", () => {
    const items = [clip("c1", "snap-1"), clip("c2", "snap-2"), clip("c3")];
    const ip: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: "c3" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-B",
    });
  });

  it("skips clips with unresolvable snapshot IDs and falls back to earlier pin", () => {
    const items = [
      clip("c1", "snap-1"),
      clip("c2", "snap-deleted"),
      clip("c3"),
    ];
    const ip: FrontendInsertionPoint = { type: "end" };
    expect(resolveForVideo(items, ip, lookup)).toEqual({
      kind: "diagram",
      diagramId: "diagram-A",
    });
  });

  it("returns home when after-chapter target is not found in items", () => {
    const items = [clip("c1", "snap-1"), section("s1")];
    const ip: FrontendInsertionPoint = {
      type: "after-chapter",
      frontendChapterId: "nonexistent" as any,
    };
    expect(resolveForVideo(items, ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns home when all items are sections (no clips to resolve)", () => {
    const items = [section("s1"), section("s2"), section("s3")];
    const ip: FrontendInsertionPoint = { type: "end" };
    expect(resolveForVideo(items, ip, lookup)).toEqual({ kind: "home" });
  });

  it("returns home when start insertion point is used with empty items", () => {
    const ip: FrontendInsertionPoint = { type: "start" };
    expect(resolveForVideo([], ip, lookup)).toEqual({ kind: "home" });
  });
});
