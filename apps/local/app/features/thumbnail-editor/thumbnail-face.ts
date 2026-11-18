/**
 * The face while a Thumbnail Diagram is being edited. It rides in the editor
 * document's meta, under `THUMBNAIL_FACE_KEY`, so moving, nudging or retaking
 * it is an undo step on the same history as the drawing. Saving splits it
 * back out: the face goes to the Thumbnail's layers, and the Thumbnail
 * Diagram is saved as the drawing alone (`withoutFace`), so inserting it
 * elsewhere never brings the face along.
 */
export type ThumbnailFace = {
  photo: string;
  cutout: string | null;
  horizontalPosition: number;
};

/** The document meta key the face lives under while editing. */
export const THUMBNAIL_FACE_KEY = "thumbnailFace";

/**
 * How a face change goes onto the editor's history: as an undo step of its
 * own, folded into the step before it (the rest of one slider drag), or not
 * at all (the face a Thumbnail opens with, or a first capture's Cutout).
 */
export type FaceHistory = "new-step" | "same-step" | "silent";

export const sameFace = (
  a: ThumbnailFace | null,
  b: ThumbnailFace | null
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.photo === b.photo &&
    a.cutout === b.cutout &&
    a.horizontalPosition === b.horizontalPosition);

type StoredRecord = { typeName?: unknown; meta?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A tldraw `document` with the face taken out of its document record's meta. */
export function withoutFace<D extends { store: object }>(document: D): D {
  const store: Record<string, unknown> = { ...document.store };
  for (const [id, record] of Object.entries(store)) {
    const r = record as StoredRecord;
    if (r.typeName !== "document" || !isRecord(r.meta)) continue;
    if (!(THUMBNAIL_FACE_KEY in r.meta)) continue;
    const { [THUMBNAIL_FACE_KEY]: _face, ...meta } = r.meta;
    store[id] = { ...(record as object), meta };
  }
  return { ...document, store };
}

/** The face held in a document record's meta, if it holds a whole one. */
export function readFaceMeta(meta: unknown): ThumbnailFace | null {
  if (!isRecord(meta)) return null;
  const face = meta[THUMBNAIL_FACE_KEY];
  if (!isRecord(face)) return null;
  const { photo, cutout, horizontalPosition } = face;
  if (typeof photo !== "string" || typeof horizontalPosition !== "number")
    return null;
  if (cutout !== null && typeof cutout !== "string") return null;
  return { photo, cutout, horizontalPosition };
}
