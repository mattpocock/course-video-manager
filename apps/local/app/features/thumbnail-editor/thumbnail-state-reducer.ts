import type { EffectReducer } from "use-effect-reducer";
import type { ThumbnailLayers } from "./canvas-compositor";
import {
  withoutFace,
  type FaceHistory,
  type ThumbnailFace,
} from "./thumbnail-face";
import {
  mergeThumbnailDiagramSources,
  type ThumbnailDiagramSource,
} from "@cvm/core/lib/thumbnail-diagram-sources";

import type { ThumbnailDiagramDocument } from "@cvm/core/lib/thumbnail-diagram";

/** Arrow-key nudges of the face, in slider units (100 = its whole travel). */
export const FACE_NUDGE = 0.25;
export const FACE_BIG_NUDGE = 2.5;

export namespace thumbnailStateReducer {
  export interface State {
    /** The camera modal, which takes its still from the recorder service (#2012). */
    cameraOpen: boolean;
    capturedPhoto: string | null;
    /**
     * A pasted diagram PNG. Only a Thumbnail saved before Thumbnail Diagrams
     * has one; while it does, the page shows the old pasted-PNG layer.
     */
    diagramImage: string | null;
    diagramPosition: number;
    /** The Thumbnail Diagram as last edited or loaded; null until drawn on. */
    thumbnailDiagram: ThumbnailDiagramDocument | null;
    /** The Thumbnail Diagram drawn as a 1280×720 PNG, for the composite. */
    drawingImage: string | null;
    /**
     * Where this Thumbnail's inserts came from since it was opened. Sent with
     * every save; the server adds them to the ones already recorded.
     */
    diagramSources: readonly ThumbnailDiagramSource[];
    /**
     * Bumped whenever a different Thumbnail's drawing is loaded, so the page
     * mounts a fresh editor (and undo history) for it, and only then.
     */
    diagramSession: number;
    cutoutImage: string | null;
    cutoutPosition: number;
    /**
     * Where a drag of the face slider is: one drag is one undo step, so only
     * its first move starts a step.
     */
    faceSlide: "idle" | "started" | "moving";
    /**
     * The capture in progress replaces a face: once its background removal
     * settles, the new photo and Cutout go on the history as one undo step.
     */
    retaking: boolean;
    removingBackground: boolean;
    backgroundRemovalError: string | null;
    saving: boolean;
    deleting: string | null;
    editingThumbnailId: string | null;
    loadingEdit: string | null;
    previewDataUrl: string | null;
    pendingAutoSave: boolean;
  }

  export type Action =
    // Camera
    | { type: "open-camera" }
    | { type: "close-camera" }
    | { type: "photo-captured"; dataUrl: string }
    // Background Removal
    | { type: "background-removal-succeeded"; dataUrl: string }
    | { type: "background-removal-failed"; error: string }
    | { type: "retry-background-removal" }
    // Diagram
    | { type: "diagram-pasted"; dataUrl: string; position: number }
    | { type: "diagram-removed" }
    | { type: "diagram-position-changed"; value: number }
    // Thumbnail Diagram
    /** The author edited the drawing; `image` is it, drawn for the composite. */
    | {
        type: "drawing-changed";
        document: ThumbnailDiagramDocument;
        image: string | null;
      }
    /** A loaded drawing, drawn for the composite: not an edit. */
    | { type: "drawing-rendered"; image: string | null }
    /** The palette inserted a Diagram Component or DiagramSnapshot. */
    | { type: "insert-source-recorded"; source: ThumbnailDiagramSource }
    // Cutout
    | { type: "cutout-removed" }
    | { type: "cutout-position-changed"; value: number }
    /** ←/→ on the face slider; `big` with Shift held. */
    | { type: "face-nudged"; direction: -1 | 1; big: boolean }
    /** The pointer went down / up on the face slider. */
    | { type: "face-slide-started" }
    | { type: "face-slide-ended" }
    /** The editor's undo or redo put the face back to this. */
    | { type: "face-restored"; face: ThumbnailFace }
    // Save
    | { type: "save-requested"; videoId: string; compositeDataUrl: string }
    /** `diagramSession` is the one the save was made in. */
    | { type: "save-succeeded"; thumbnailId: string; diagramSession: number }
    | { type: "save-failed" }
    // Delete
    | { type: "delete-requested"; thumbnailId: string }
    | { type: "delete-succeeded" }
    | { type: "delete-failed" }
    // Edit
    | { type: "edit-requested"; thumbnailId: string; videoId: string }
    | {
        type: "edit-loaded";
        thumbnailId: string;
        videoId: string;
        capturedPhoto: string;
        diagramImage: string | null;
        diagramPosition: number;
        cutoutImage: string | null;
        cutoutPosition: number;
        thumbnailDiagram: ThumbnailDiagramDocument | null;
      }
    | { type: "edit-failed" }
    // New Thumbnail
    | { type: "new-thumbnail-clicked"; videoId: string }
    /** The page is going away (`pagehide`): an edit waiting to save saves now. */
    | { type: "page-hidden"; videoId: string }
    // Preview
    | { type: "preview-updated"; dataUrl: string | null };

  export type Effect =
    | { type: "remove-background"; dataUrl: string }
    /** Write the face into the editor's document, on its undo history. */
    | { type: "record-face"; face: ThumbnailFace; history: FaceHistory }
    | {
        type: "save-thumbnail";
        videoId: string;
        compositeDataUrl: string;
        capturedPhoto: string;
        diagramImage: string | null;
        diagramPosition: number;
        cutoutImage: string | null;
        cutoutPosition: number;
        thumbnailDiagram: ThumbnailDiagramDocument | null;
        diagramSources: readonly ThumbnailDiagramSource[];
        editingThumbnailId: string | null;
        /** Which opened Thumbnail it saves: see `save-succeeded`. */
        diagramSession: number;
      }
    | { type: "delete-thumbnail"; thumbnailId: string }
    | { type: "load-thumbnail"; thumbnailId: string }
    | { type: "revalidate" };
}

const INITIAL_EDITOR_STATE = {
  capturedPhoto: null,
  diagramImage: null,
  diagramPosition: 50,
  cutoutImage: null,
  cutoutPosition: 50,
  faceSlide: "idle",
  retaking: false,
  thumbnailDiagram: null,
  drawingImage: null,
  diagramSources: [],
  editingThumbnailId: null,
  backgroundRemovalError: null,
  previewDataUrl: null,
  pendingAutoSave: false,
} as const satisfies Partial<thumbnailStateReducer.State>;

/**
 * Puts a face change on the editor's undo history. Only a Thumbnail Diagram
 * has one: an old pasted-PNG Thumbnail has no editor.
 */
const recordFace = (
  state: thumbnailStateReducer.State,
  face: Partial<ThumbnailFace>,
  history: FaceHistory,
  exec: (effect: thumbnailStateReducer.Effect) => void
) => {
  if (!state.capturedPhoto || selectDiagramKind(state) !== "drawing") return;
  exec({
    type: "record-face",
    face: {
      photo: state.capturedPhoto,
      cutout: state.cutoutImage,
      horizontalPosition: state.cutoutPosition,
      ...face,
    },
    history,
  });
};

type FaceAction = Extract<
  thumbnailStateReducer.Action,
  {
    type:
      | "cutout-removed"
      | "cutout-position-changed"
      | "face-nudged"
      | "face-slide-started"
      | "face-slide-ended"
      | "face-restored";
  }
>;

/** The face's own events: each change it makes is recorded as an undo step. */
function reduceFace(
  state: thumbnailStateReducer.State,
  action: FaceAction,
  exec: (effect: thumbnailStateReducer.Effect) => void
): thumbnailStateReducer.State {
  switch (action.type) {
    case "cutout-removed":
      recordFace(state, { cutout: null }, "new-step", exec);
      return {
        ...state,
        cutoutImage: null,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
    case "cutout-position-changed":
      recordFace(
        state,
        { horizontalPosition: action.value },
        state.faceSlide === "moving" ? "same-step" : "new-step",
        exec
      );
      return {
        ...state,
        cutoutPosition: action.value,
        faceSlide: state.faceSlide === "idle" ? "idle" : "moving",
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };

    case "face-nudged": {
      const cutoutPosition = Math.min(
        100,
        Math.max(
          0,
          state.cutoutPosition +
            action.direction * (action.big ? FACE_BIG_NUDGE : FACE_NUDGE)
        )
      );
      recordFace(
        state,
        { horizontalPosition: cutoutPosition },
        "new-step",
        exec
      );
      return {
        ...state,
        cutoutPosition,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
    }
    case "face-slide-started":
      return { ...state, faceSlide: "started" };
    case "face-slide-ended":
      return { ...state, faceSlide: "idle" };
    case "face-restored":
      return {
        ...state,
        capturedPhoto: action.face.photo,
        cutoutImage: action.face.cutout,
        cutoutPosition: action.face.horizontalPosition,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
  }
}

type SaveThumbnailEffect = Extract<
  thumbnailStateReducer.Effect,
  { type: "save-thumbnail" }
>;

const saveEffect = (
  state: thumbnailStateReducer.State & { capturedPhoto: string },
  videoId: string,
  compositeDataUrl: string
): SaveThumbnailEffect => ({
  type: "save-thumbnail",
  videoId,
  compositeDataUrl,
  capturedPhoto: state.capturedPhoto,
  diagramImage: state.diagramImage,
  diagramPosition: state.diagramPosition,
  cutoutImage: state.cutoutImage,
  cutoutPosition: state.cutoutPosition,
  // The face goes to the layers above; the Thumbnail Diagram is the
  // drawing alone.
  thumbnailDiagram:
    selectDiagramKind(state) === "drawing" && state.thumbnailDiagram
      ? withoutFace(state.thumbnailDiagram)
      : null,
  diagramSources: state.diagramSources,
  editingThumbnailId: state.editingThumbnailId,
  diagramSession: state.diagramSession,
});

/**
 * The save an edit still waiting for its autosave needs, made now: the
 * Thumbnail is being left (another opened, New, the page going away), and
 * its drawing and insert sources live nowhere else. Null when nothing waits,
 * or when the Thumbnail's first create is still out (a second would make a
 * copy). The composite is the preview's, the last one drawn.
 */
export const selectPendingSave = (
  state: thumbnailStateReducer.State,
  videoId: string
): SaveThumbnailEffect | null => {
  const { capturedPhoto, previewDataUrl } = state;
  if (!state.pendingAutoSave || !capturedPhoto || !previewDataUrl) return null;
  if (state.saving && !state.editingThumbnailId) return null;
  return saveEffect({ ...state, capturedPhoto }, videoId, previewDataUrl);
};

const flushPendingSave = (
  state: thumbnailStateReducer.State,
  videoId: string,
  exec: (effect: thumbnailStateReducer.Effect) => void
): thumbnailStateReducer.State => {
  const save = selectPendingSave(state, videoId);
  if (!save) return state;
  exec(save);
  return { ...state, saving: true, pendingAutoSave: false };
};

export const createInitialThumbnailState = (): thumbnailStateReducer.State => ({
  cameraOpen: false,
  ...INITIAL_EDITOR_STATE,
  diagramSession: 0,
  removingBackground: false,
  saving: false,
  deleting: null,
  loadingEdit: null,
});

export const thumbnailStateReducer: EffectReducer<
  thumbnailStateReducer.State,
  thumbnailStateReducer.Action,
  thumbnailStateReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    // Camera
    case "open-camera":
      return { ...state, cameraOpen: true };
    case "close-camera":
      return { ...state, cameraOpen: false };
    case "photo-captured":
      exec({ type: "remove-background", dataUrl: action.dataUrl });
      return {
        ...state,
        // Recorded once background removal settles, as one undo step.
        retaking: state.capturedPhoto !== null,
        capturedPhoto: action.dataUrl,
        cutoutImage: null,
        backgroundRemovalError: null,
        removingBackground: true,
      };

    // Background Removal
    case "background-removal-succeeded":
      // A first capture's Cutout has nothing before it to undo back to.
      recordFace(
        state,
        { cutout: action.dataUrl },
        state.retaking ? "new-step" : "silent",
        exec
      );
      return {
        ...state,
        retaking: false,
        cutoutImage: action.dataUrl,
        removingBackground: false,
        pendingAutoSave: true,
      };
    case "background-removal-failed":
      if (state.retaking) recordFace(state, { cutout: null }, "new-step", exec);
      return {
        ...state,
        backgroundRemovalError: action.error,
        removingBackground: false,
      };
    case "retry-background-removal":
      if (!state.capturedPhoto) return state;
      exec({ type: "remove-background", dataUrl: state.capturedPhoto });
      return {
        ...state,
        backgroundRemovalError: null,
        removingBackground: true,
      };

    // Diagram
    case "diagram-pasted":
      // Only an old Thumbnail's pasted PNG is replaced by a paste: anything
      // else has a Thumbnail Diagram, and the editor refuses images.
      if (selectDiagramKind(state) === "drawing") return state;
      return {
        ...state,
        diagramImage: action.dataUrl,
        diagramPosition: action.position,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
    case "diagram-removed":
      return {
        ...state,
        diagramImage: null,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
    case "diagram-position-changed":
      return {
        ...state,
        diagramPosition: action.value,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };

    // Thumbnail Diagram
    case "drawing-changed":
      return {
        ...state,
        thumbnailDiagram: action.document,
        drawingImage: action.image,
        // No face yet, no Thumbnail to save it to.
        ...(state.capturedPhoto && { pendingAutoSave: true }),
      };
    case "drawing-rendered":
      return { ...state, drawingImage: action.image };
    case "insert-source-recorded":
      return {
        ...state,
        diagramSources: mergeThumbnailDiagramSources(state.diagramSources, [
          action.source,
        ]),
        ...(state.capturedPhoto && { pendingAutoSave: true }),
      };

    // Cutout: the face, on the editor's undo history.
    case "cutout-removed":
    case "cutout-position-changed":
    case "face-nudged":
    case "face-slide-started":
    case "face-slide-ended":
    case "face-restored":
      return reduceFace(state, action, exec);

    // Save
    case "save-requested": {
      const { capturedPhoto } = state;
      if (!capturedPhoto) return state;
      exec(
        saveEffect(
          { ...state, capturedPhoto },
          action.videoId,
          action.compositeDataUrl
        )
      );
      return { ...state, saving: true, pendingAutoSave: false };
    }
    case "save-succeeded":
      exec({ type: "revalidate" });
      // A save flushed on the way to another Thumbnail (or New) lands after
      // it opened: that one stays open.
      if (action.diagramSession !== state.diagramSession) {
        return { ...state, saving: false };
      }
      return {
        ...state,
        saving: false,
        editingThumbnailId: action.thumbnailId,
      };
    case "save-failed":
      return { ...state, saving: false };

    // Delete
    case "delete-requested":
      exec({ type: "delete-thumbnail", thumbnailId: action.thumbnailId });
      return { ...state, deleting: action.thumbnailId };
    case "delete-succeeded":
      exec({ type: "revalidate" });
      return { ...state, deleting: null };
    case "delete-failed":
      return { ...state, deleting: null };

    // Edit
    case "edit-requested":
      exec({ type: "load-thumbnail", thumbnailId: action.thumbnailId });
      return {
        ...flushPendingSave(state, action.videoId, exec),
        loadingEdit: action.thumbnailId,
      };
    case "edit-loaded":
      return {
        // An edit made while it loaded belongs to the Thumbnail being left.
        ...flushPendingSave(state, action.videoId, exec),
        loadingEdit: null,
        editingThumbnailId: action.thumbnailId,
        capturedPhoto: action.capturedPhoto,
        diagramImage: action.diagramImage,
        diagramPosition: action.diagramPosition,
        cutoutImage: action.cutoutImage,
        cutoutPosition: action.cutoutPosition,
        thumbnailDiagram: action.thumbnailDiagram,
        drawingImage: null,
        diagramSources: [],
        diagramSession: state.diagramSession + 1,
        backgroundRemovalError: null,
      };
    case "edit-failed":
      return { ...state, loadingEdit: null };

    // New Thumbnail
    case "new-thumbnail-clicked":
      return {
        ...flushPendingSave(state, action.videoId, exec),
        ...INITIAL_EDITOR_STATE,
        diagramSession: state.diagramSession + 1,
      };

    case "page-hidden":
      return flushPendingSave(state, action.videoId, exec);

    // Preview
    case "preview-updated":
      return { ...state, previewDataUrl: action.dataUrl };
  }
  action satisfies never;
};

/**
 * What the Thumbnail's diagram is: an old Thumbnail's pasted PNG, while it
 * has one, or otherwise a Thumbnail Diagram drawn in the editor.
 */
export const selectDiagramKind = (
  state: thumbnailStateReducer.State
): "pasted" | "drawing" => (state.diagramImage ? "pasted" : "drawing");

/** The layers the composite (and the saved PNG) is drawn from. */
export const selectCompositeLayers = (
  state: thumbnailStateReducer.State
): ThumbnailLayers =>
  selectDiagramKind(state) === "pasted"
    ? {
        capturedPhoto: state.capturedPhoto,
        diagramImage: state.diagramImage,
        diagramPosition: state.diagramPosition,
        cutoutImage: state.cutoutImage,
        cutoutPosition: state.cutoutPosition,
      }
    : {
        capturedPhoto: state.capturedPhoto,
        // The drawing is exported at the frame's own 1280×720, which the
        // compositor draws at x = 0 from position 50.
        diagramImage: state.drawingImage,
        diagramPosition: 50,
        cutoutImage: state.cutoutImage,
        cutoutPosition: state.cutoutPosition,
      };
