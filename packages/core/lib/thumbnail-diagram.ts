/**
 * A Thumbnail Diagram as saved: a tldraw `document` (`getSnapshot(store)
 * .document`), the same format as a Diagram's head (ADR 0060). Validated only
 * this deep, as a Diagram save is.
 */
export type ThumbnailDiagramDocument = { store: object; schema: object };
