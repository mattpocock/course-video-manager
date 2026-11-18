import { entityPath } from "@/features/entity-links/entity-deep-link";
import { highlightedSnapshotUrl } from "@/lib/diagram-protocol";
import type { DiagramTarget } from "./palette-reducer";

/**
 * Where "go to" on a diagram search result opens it, in either editor: a
 * Diagram in the playground (a DiagramSnapshot highlighted, never restored),
 * and a Thumbnail Diagram's Thumbnail in the thumbnail creator.
 */
export function goToUrl(target: DiagramTarget): string {
  switch (target.source) {
    case "snapshot":
    case "current":
      return highlightedSnapshotUrl(
        target.diagramId,
        target.highlightSnapshotId
      );
    case "thumbnail-diagram":
      return entityPath({
        type: "thumbnail",
        id: target.thumbnailId,
        videoId: target.videoId,
      });
  }
}
