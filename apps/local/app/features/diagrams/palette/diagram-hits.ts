/**
 * The hits diagram search returns, in either editor, and what "go to" and
 * "Insert diagram" make of each: a Diagram's head, a DiagramSnapshot, or a
 * past Thumbnail's Thumbnail Diagram (ADR 0060).
 */

import type { ThumbnailDiagramHit } from "@cvm/core/lib/thumbnail-diagram";

/** A Diagram's head (`current`), or one of its DiagramSnapshots. */
export type DrawingHit = {
  diagramId: string;
  snapshotId: string | null;
  diagramName: string;
  contentHash: string | null;
  searchText: string | null;
  source: "snapshot" | "current";
};

export type DiagramHit = DrawingHit | ThumbnailDiagramHit;

/**
 * What "go to this result" needs to know. Going to a DiagramSnapshot hit opens
 * its Diagram with that snapshot highlighted in the Snapshot Timeline; it is
 * never restored to the head, so a search result can't change what the next
 * Clip is filmed against. Restore to Head is its own explicit action. A
 * Thumbnail Diagram hit opens its Thumbnail in the thumbnail creator.
 */
export type DiagramTarget =
  | (Pick<DrawingHit, "diagramId" | "source"> & {
      highlightSnapshotId: string | null;
    })
  | Pick<ThumbnailDiagramHit, "source" | "thumbnailId" | "videoId">;

/**
 * What inserting a result needs to know: which drawing to fetch (a
 * DiagramSnapshot's, the Diagram's head when `snapshotId` is null, or a
 * Thumbnail's Thumbnail Diagram), and the kind of hit it was.
 */
export type DiagramInsertTarget =
  | Pick<DrawingHit, "diagramId" | "snapshotId" | "source">
  | Pick<ThumbnailDiagramHit, "source" | "thumbnailId">;

export const goToTarget = (hit: DiagramHit): DiagramTarget => {
  switch (hit.source) {
    case "snapshot":
    case "current":
      // Looking, not restoring: a snapshot hit only highlights the snapshot.
      return {
        diagramId: hit.diagramId,
        source: hit.source,
        highlightSnapshotId: hit.snapshotId,
      };
    case "thumbnail-diagram":
      return {
        source: hit.source,
        thumbnailId: hit.thumbnailId,
        videoId: hit.videoId,
      };
  }
};

export const insertTarget = (hit: DiagramHit): DiagramInsertTarget => {
  switch (hit.source) {
    case "snapshot":
    case "current":
      return {
        diagramId: hit.diagramId,
        snapshotId: hit.snapshotId,
        source: hit.source,
      };
    case "thumbnail-diagram":
      return { source: hit.source, thumbnailId: hit.thumbnailId };
  }
};

/** A diagram hit's cmdk value: its snapshot, its Diagram's head, or its Thumbnail. */
export const diagramHitKey = (hit: DiagramHit): string => {
  switch (hit.source) {
    case "snapshot":
    case "current":
      return hit.snapshotId ?? `${hit.diagramId}:current`;
    case "thumbnail-diagram":
      return `thumbnail:${hit.thumbnailId}`;
  }
};
