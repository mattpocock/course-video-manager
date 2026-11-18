/**
 * The face on the thumbnail editor's undo history. The face is written into
 * the tldraw document record's meta, so the editor's own undo and redo move
 * it back and forth with the drawing; whatever face they restore is reported
 * to the page (`onFaceRestored`), which saves it.
 */
import type { Editor } from "tldraw";
import {
  readFaceMeta,
  sameFace,
  THUMBNAIL_FACE_KEY,
  type FaceHistory,
  type ThumbnailFace,
} from "./thumbnail-face";

/** What the page asks of the thumbnail editor's history. */
export interface ThumbnailEditorHistory {
  recordFace: (face: ThumbnailFace, history: FaceHistory) => void;
  /** For Cmd+Z outside the canvas (the face slider), which tldraw ignores. */
  undo: () => void;
  redo: () => void;
}

function writeFace(editor: Editor, face: ThumbnailFace, history: FaceHistory) {
  if (history === "new-step") editor.markHistoryStoppingPoint("face");
  // NOT `updateDocumentSettings`: tldraw runs that with history ignored. A
  // plain put of the document record is recorded like any shape change.
  const doc = editor.getDocumentSettings();
  editor.run(
    () =>
      editor.store.put([
        { ...doc, meta: { ...doc.meta, [THUMBNAIL_FACE_KEY]: face } },
      ]),
    { history: history === "silent" ? "ignore" : "record" }
  );
  // An undo puts back the whole document record as it was before its step,
  // so a later unrecorded face would be lost to it: a silent write starts the
  // history afresh instead.
  if (history === "silent") editor.clearHistory();
}

/**
 * Puts `initialFace` into the document, as the start of the undo history
 * (it clears what came before), and starts reporting
 * the faces the editor's undo and redo restore. Call it once the drawing is
 * loaded; `dispose` stops the reports.
 */
export function attachFaceHistory(
  editor: Editor,
  initialFace: ThumbnailFace,
  onFaceRestored: (face: ThumbnailFace) => void
): { history: ThumbnailEditorHistory; dispose: () => void } {
  // The face last written or reported: anything else in the document is an
  // undo or redo.
  let known: ThumbnailFace = initialFace;
  writeFace(editor, initialFace, "silent");

  const dispose = editor.store.listen(
    () => {
      const face = readFaceMeta(editor.getDocumentSettings().meta);
      if (!face || sameFace(face, known)) return;
      known = face;
      onFaceRestored(face);
    },
    { scope: "document" }
  );

  return {
    history: {
      recordFace: (face, history) => {
        known = face;
        writeFace(editor, face, history);
      },
      undo: () => editor.undo(),
      redo: () => editor.redo(),
    },
    dispose,
  };
}
