/**
 * Point a duplicated Thumbnail's stored paths at the duplicate's OWN Video
 * File directory.
 *
 * A Thumbnail stores ABSOLUTE paths — `filePath` for the composite, and one
 * per layer inside the `layers` JSON — all of them written under
 * `{VIDEO_FILES_DIR}/{lineageId}/` by the routes that create it. A duplicated
 * Video gets a FRESH `lineageId`, so copying those paths verbatim does not
 * strand them: it ALIASES them onto the source Video's files. The copy renders
 * the source's picture, and editing the copy's Thumbnail writes over the
 * source's PNG, because the update route writes back to the path on the row
 * (#1674).
 *
 * Rewriting the paths is the row half of the fix; `copyVideoFilesDirectory` in
 * `apps/local` puts the bytes where they now point. It is pure string work, so
 * it can live in `@cvm/core` — which has no disk and must not grow one.
 *
 * A path that does not name the source's lineage directory is left ALONE. It
 * is not a path this code wrote, and there is no way to know where its file
 * should go; an alias a human can still see beats a path that points nowhere.
 */

/** Rewrite one path's `/{sourceLineageId}/` segment to the duplicate's. */
export const rebaseLineagePath = (
  value: string,
  sourceLineageId: string,
  newLineageId: string
): string => value.split(`/${sourceLineageId}/`).join(`/${newLineageId}/`);

/**
 * The same, over every string anywhere inside a Thumbnail's `layers` JSON.
 *
 * Walks the value rather than naming `backgroundPhoto`, `diagram` and
 * `cutout`: the layer shape has grown before, and a layer whose path this
 * missed would keep writing into the source Video's directory silently.
 */
export const rebaseLineagePathsDeep = (
  value: unknown,
  sourceLineageId: string,
  newLineageId: string
): unknown => {
  if (typeof value === "string") {
    return rebaseLineagePath(value, sourceLineageId, newLineageId);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      rebaseLineagePathsDeep(item, sourceLineageId, newLineageId)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rebaseLineagePathsDeep(item, sourceLineageId, newLineageId),
      ])
    );
  }
  return value;
};
