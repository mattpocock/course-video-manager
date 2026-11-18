import type { EffectReducer } from "use-effect-reducer";
import type { ThumbnailLayers } from "./canvas-compositor";
import {
  mergeThumbnailDiagramSources,
  type ThumbnailDiagramSource,
} from "@cvm/core/lib/thumbnail-diagram-sources";

/**
 * A Thumbnail Diagram as saved: a tldraw `document` (`getSnapshot(store)
 * .document`), the same format as a Diagram's head (ADR 0060).
 */
export type ThumbnailDiagramDocument = { store: object; schema: object };

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
    // Save
    | { type: "save-requested"; videoId: string; compositeDataUrl: string }
    | { type: "save-succeeded"; thumbnailId: string }
    | { type: "save-failed" }
    // Delete
    | { type: "delete-requested"; thumbnailId: string }
    | { type: "delete-succeeded" }
    | { type: "delete-failed" }
    // Edit
    | { type: "edit-requested"; thumbnailId: string }
    | {
        type: "edit-loaded";
        thumbnailId: string;
        capturedPhoto: string;
        diagramImage: string | null;
        diagramPosition: number;
        cutoutImage: string | null;
        cutoutPosition: number;
        thumbnailDiagram: ThumbnailDiagramDocument | null;
      }
    | { type: "edit-failed" }
    // New Thumbnail
    | { type: "new-thumbnail-clicked" }
    // Preview
    | { type: "preview-updated"; dataUrl: string | null };

  export type Effect =
    | { type: "remove-background"; dataUrl: string }
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
  thumbnailDiagram: null,
  drawingImage: null,
  diagramSources: [],
  editingThumbnailId: null,
  backgroundRemovalError: null,
  previewDataUrl: null,
  pendingAutoSave: false,
} as const;

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
        capturedPhoto: action.dataUrl,
        cutoutImage: null,
        backgroundRemovalError: null,
        removingBackground: true,
      };

    // Background Removal
    case "background-removal-succeeded":
      return {
        ...state,
        cutoutImage: action.dataUrl,
        removingBackground: false,
        pendingAutoSave: true,
      };
    case "background-removal-failed":
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

    // Cutout
    case "cutout-removed":
      return {
        ...state,
        cutoutImage: null,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };
    case "cutout-position-changed":
      return {
        ...state,
        cutoutPosition: action.value,
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };

    case "face-nudged":
      return {
        ...state,
        cutoutPosition: Math.min(
          100,
          Math.max(
            0,
            state.cutoutPosition +
              action.direction * (action.big ? FACE_BIG_NUDGE : FACE_NUDGE)
          )
        ),
        ...(state.editingThumbnailId && { pendingAutoSave: true }),
      };

    // Save
    case "save-requested":
      if (!state.capturedPhoto) return state;
      exec({
        type: "save-thumbnail",
        videoId: action.videoId,
        compositeDataUrl: action.compositeDataUrl,
        capturedPhoto: state.capturedPhoto,
        diagramImage: state.diagramImage,
        diagramPosition: state.diagramPosition,
        cutoutImage: state.cutoutImage,
        cutoutPosition: state.cutoutPosition,
        thumbnailDiagram:
          selectDiagramKind(state) === "drawing"
            ? state.thumbnailDiagram
            : null,
        diagramSources: state.diagramSources,
        editingThumbnailId: state.editingThumbnailId,
      });
      return { ...state, saving: true, pendingAutoSave: false };
    case "save-succeeded":
      exec({ type: "revalidate" });
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
      return { ...state, loadingEdit: action.thumbnailId };
    case "edit-loaded":
      return {
        ...state,
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
        ...state,
        ...INITIAL_EDITOR_STATE,
        diagramSession: state.diagramSession + 1,
      };

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
