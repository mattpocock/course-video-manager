import type { FrontendInsertionPoint } from "@/features/video-editor/clip-state-reducer.types";

export type DiagramAction =
  | { kind: "diagram"; diagramId: string }
  | { kind: "home" };

export type ResolverClip = {
  diagramSnapshotId: string | null;
};

export type ResolverTimelineItem = {
  frontendId: string;
  kind: "clip" | "chapter";
  diagramSnapshotId: string | null;
};

export type SnapshotToDiagramId = (snapshotId: string) => string | null;

export function resolveForClip(
  clip: ResolverClip,
  snapshotToDiagramId: SnapshotToDiagramId
): DiagramAction {
  if (!clip.diagramSnapshotId) return { kind: "home" };
  const diagramId = snapshotToDiagramId(clip.diagramSnapshotId);
  if (!diagramId) return { kind: "home" };
  return { kind: "diagram", diagramId };
}

export function resolveForVideo(
  items: ResolverTimelineItem[],
  insertionPoint: FrontendInsertionPoint,
  snapshotToDiagramId: SnapshotToDiagramId
): DiagramAction {
  if (insertionPoint.type === "start") return { kind: "home" };

  let endIndex: number;
  if (insertionPoint.type === "end") {
    endIndex = items.length - 1;
  } else {
    const targetId =
      insertionPoint.type === "after-clip"
        ? insertionPoint.frontendClipId
        : insertionPoint.frontendChapterId;
    endIndex = items.findIndex((item) => item.frontendId === targetId);
    if (endIndex === -1) return { kind: "home" };
  }

  for (let i = endIndex; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "clip" && item.diagramSnapshotId) {
      const diagramId = snapshotToDiagramId(item.diagramSnapshotId);
      if (diagramId) return { kind: "diagram", diagramId };
    }
  }

  return { kind: "home" };
}
