import type { EffectReducer } from "use-effect-reducer";

export namespace thumbnailStateReducer {
  export interface State {
    cameraOpen: boolean;
    capturedPhoto: string | null;
    diagramImage: string | null;
    diagramPosition: number;
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
    // Cutout
    | { type: "cutout-removed" }
    | { type: "cutout-position-changed"; value: number }
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
  editingThumbnailId: null,
  backgroundRemovalError: null,
  previewDataUrl: null,
  pendingAutoSave: false,
} as const;

export const createInitialThumbnailState = (): thumbnailStateReducer.State => ({
  cameraOpen: false,
  ...INITIAL_EDITOR_STATE,
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
        backgroundRemovalError: null,
      };
    case "edit-failed":
      return { ...state, loadingEdit: null };

    // New Thumbnail
    case "new-thumbnail-clicked":
      return {
        ...state,
        ...INITIAL_EDITOR_STATE,
      };

    // Preview
    case "preview-updated":
      return { ...state, previewDataUrl: action.dataUrl };
  }
  action satisfies never;
};
