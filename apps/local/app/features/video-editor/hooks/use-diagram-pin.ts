import { useCallback } from "react";
import type { FrontendId, TimelineItem } from "../clip-state-reducer.types";

export type UpdateClipDiagramPinFn = (
  clipFrontendId: FrontendId,
  clipDatabaseId: string,
  diagramSnapshotId: string | null,
  diagramName: string | null
) => void;

export const useDiagramPin = (
  items: TimelineItem[],
  onUpdateClipDiagramPin: UpdateClipDiagramPinFn
) => {
  const onUnpinDiagram = useCallback(
    (clipId: FrontendId) => {
      const clip = items.find(
        (c) => c.frontendId === clipId && c.type === "on-database"
      );
      if (clip?.type === "on-database") {
        onUpdateClipDiagramPin(clipId, clip.databaseId as string, null, null);
      }
    },
    [items, onUpdateClipDiagramPin]
  );

  return {
    onUnpinDiagram,
  };
};
