import type { ThumbnailDiagramSource } from "./thumbnail-diagram-sources.js";

/**
 * A Thumbnail Diagram as saved: a tldraw `document` (`getSnapshot(store)
 * .document`), the same format as a Diagram's head (ADR 0060). Validated only
 * this deep, as a Diagram save is.
 */
export type ThumbnailDiagramDocument = { store: object; schema: object };

/**
 * A Thumbnail Diagram found by diagram search, labelled with its Video. It is
 * not a Diagram (ADR 0060): it opens in, and is inserted from, its Thumbnail.
 */
export type ThumbnailDiagramHit = {
  source: "thumbnail-diagram";
  thumbnailId: string;
  videoId: string;
  videoTitle: string;
  searchText: string | null;
};

/** What `collapseVersionCopies` reads of a matched Thumbnail. */
type MatchedThumbnail = {
  thumbnailId: string;
  videoId: string;
  /** Its Video's lineage: a Version copy of a Video keeps it. */
  lineageId: string;
  /** Equal for equal drawings. */
  contentHash: string;
  diagramSources: readonly ThumbnailDiagramSource[];
};

/**
 * `matches` less each Thumbnail that a Version copy stands for: a copy that
 * records it as its source, on another Video row of the same lineage (Submit
 * keeps a Video's lineage), with the drawing unchanged. Every other pair of
 * equal drawings stays two hits: A/B Thumbnails of one Video, or a drawing
 * copied to a different Video.
 */
export function collapseVersionCopies<T extends MatchedThumbnail>(
  matches: readonly T[]
): T[] {
  const standsFor = (copy: T, original: T) =>
    copy.videoId !== original.videoId &&
    copy.lineageId === original.lineageId &&
    copy.contentHash === original.contentHash &&
    copy.diagramSources.some(
      (source) =>
        source.kind === "thumbnail-diagram" &&
        source.thumbnailId === original.thumbnailId
    );
  return matches.filter(
    (original) => !matches.some((copy) => standsFor(copy, original))
  );
}
