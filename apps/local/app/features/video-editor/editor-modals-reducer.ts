import type { EffectReducer } from "use-effect-reducer";
import type { FrontendId } from "./clip-state-reducer.types";

/**
 * The video editor's own dialogs. The chapter-naming and Autofill chapters
 * dialogs keep their own hooks. See docs/FRONTEND_STATE.md.
 */
export namespace editorModalsReducer {
  /** The editor's dialogs. Only one is open at a time. */
  export type Modal =
    | "add-video"
    | "paste-file"
    | "rename-video"
    | "copy-video"
    | "create-video-from-selection"
    | "mic-settings"
    | "edit-transcript";

  export interface State {
    openModal: Modal | null;
    /** The CVM-recorder Clip the Mic Settings dialog is open on. */
    micSettingsClipId: FrontendId | null;
    /** The Clip the Edit Transcript dialog is open on. */
    editTranscriptClipId: FrontendId | null;
  }

  export type Action =
    | { type: "add-video-to-lesson-clicked" }
    | { type: "add-note-from-clipboard-clicked" }
    | { type: "rename-video-clicked" }
    | { type: "copy-video-clicked" }
    | { type: "create-video-from-selection-clicked" }
    | { type: "mic-settings-clicked"; clipId: FrontendId }
    | { type: "edit-transcript-clicked"; clipId: FrontendId }
    /** A dialog asked to close (Escape, overlay click, Cancel, or done). */
    | { type: "modal-dismissed"; modal: Modal };

  export type Effect =
    /** Re-run the route loaders so the video's file list is current. */
    { type: "refresh-video-files" };
}

export const createInitialEditorModalsState =
  (): editorModalsReducer.State => ({
    openModal: null,
    micSettingsClipId: null,
    editTranscriptClipId: null,
  });

export const editorModalsReducer: EffectReducer<
  editorModalsReducer.State,
  editorModalsReducer.Action,
  editorModalsReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "add-video-to-lesson-clicked":
      return { ...state, openModal: "add-video" };
    case "add-note-from-clipboard-clicked":
      return { ...state, openModal: "paste-file" };
    case "rename-video-clicked":
      return { ...state, openModal: "rename-video" };
    case "copy-video-clicked":
      return { ...state, openModal: "copy-video" };
    case "create-video-from-selection-clicked":
      return { ...state, openModal: "create-video-from-selection" };
    case "mic-settings-clicked":
      return {
        ...state,
        openModal: "mic-settings",
        micSettingsClipId: action.clipId,
      };
    case "edit-transcript-clicked":
      return {
        ...state,
        openModal: "edit-transcript",
        editTranscriptClipId: action.clipId,
      };
    case "modal-dismissed":
      // Pasting a file writes it to disk, so the file list refreshes whenever
      // the paste dialog closes, whether or not it is still the open one.
      if (action.modal === "paste-file") {
        exec({ type: "refresh-video-files" });
      }
      // A late close from a dialog that has already been replaced must not
      // shut the one now on screen.
      if (state.openModal !== action.modal) return state;
      return {
        ...state,
        openModal: null,
        micSettingsClipId: null,
        editTranscriptClipId: null,
      };
  }
};
