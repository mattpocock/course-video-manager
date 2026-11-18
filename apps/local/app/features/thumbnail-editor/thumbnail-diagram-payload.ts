import { Effect } from "effect";
import { data } from "react-router";
import {
  readThumbnailDiagramSources,
  type ThumbnailDiagramSource,
} from "@cvm/core/lib/thumbnail-diagram-sources";
import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";

/**
 * Reads the `thumbnailDiagram` field the thumbnail page saves: a tldraw
 * `document` (`{ store, schema }`, the format of a Diagram's head, ADR 0060)
 * or null for a Thumbnail that keeps its pasted diagram PNG. Anything else is
 * a malformed request: undefined.
 */
function readThumbnailDiagram(
  value: unknown
): ThumbnailDiagramDocument | null | undefined {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    "store" in value &&
    "schema" in value &&
    typeof value.store === "object" &&
    value.store !== null &&
    typeof value.schema === "object" &&
    value.schema !== null
  ) {
    return { store: value.store, schema: value.schema };
  }
  return undefined;
}

/** `readThumbnailDiagram` for a route: a malformed field dies with a 400. */
export const readThumbnailDiagramField = (
  value: unknown
): Effect.Effect<ThumbnailDiagramDocument | null> => {
  const thumbnailDiagram = readThumbnailDiagram(value);
  return thumbnailDiagram === undefined
    ? Effect.die(
        data("thumbnailDiagram must be a tldraw document or null", {
          status: 400,
        })
      )
    : Effect.succeed(thumbnailDiagram);
};

/**
 * Reads the `diagramSources` field the thumbnail page saves: where its
 * inserts came from (ADR 0060). Missing records nothing; anything that isn't
 * a list of sources dies with a 400.
 */
export const readDiagramSourcesField = (
  value: unknown
): Effect.Effect<ThumbnailDiagramSource[]> => {
  const sources = readThumbnailDiagramSources(value);
  return sources === undefined
    ? Effect.die(
        data("diagramSources must be a list of insert sources", {
          status: 400,
        })
      )
    : Effect.succeed(sources);
};
