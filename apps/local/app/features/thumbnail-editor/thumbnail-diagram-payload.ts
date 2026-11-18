/**
 * Reads the `thumbnailDiagram` field the thumbnail page saves: a tldraw
 * `document` (`{ store, schema }`, the format of a Diagram's head, ADR 0060)
 * or null for a Thumbnail that keeps its pasted diagram PNG. Anything else is
 * a malformed request: undefined, so the route answers 400.
 */
export function readThumbnailDiagramField(
  value: unknown
): { store: object; schema: object } | null | undefined {
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
