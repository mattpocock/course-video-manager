import { useMemo } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { writeStored } from "@/hooks/use-local-storage";
import {
  contextPanelReducer,
  createInitialContextPanelState,
} from "./context-panel-reducer";
import {
  ANIMATIC_ENABLED_STORAGE_KEY,
  BEATS_ENABLED_STORAGE_KEY,
  COURSE_STRUCTURE_STORAGE_KEY,
  DIAGRAM_TEXT_ENABLED_STORAGE_KEY,
  LINKS_DISABLED_STORAGE_KEY,
  MEMORY_ENABLED_STORAGE_KEY,
  SCRIPT_ENABLED_STORAGE_KEY,
} from "./write-utils";

/** Where each remembered toggle is stored. */
export const REMEMBERED_TOGGLE_STORAGE_KEYS: Record<
  contextPanelReducer.RememberedToggle,
  string
> = {
  courseStructure: COURSE_STRUCTURE_STORAGE_KEY,
  memory: MEMORY_ENABLED_STORAGE_KEY,
  beats: BEATS_ENABLED_STORAGE_KEY,
  script: SCRIPT_ENABLED_STORAGE_KEY,
  animatic: ANIMATIC_ENABLED_STORAGE_KEY,
  diagramText: DIAGRAM_TEXT_ENABLED_STORAGE_KEY,
};

/**
 * The effect runner for `contextPanelReducer`, and each dialog's
 * `onOpenChange` (stable, so a dialog may list it in an effect).
 */
export function useContextPanelReducer(
  init: () => Parameters<typeof createInitialContextPanelState>[0]
) {
  const [state, dispatch] = useEffectReducer<
    contextPanelReducer.State,
    contextPanelReducer.Action,
    contextPanelReducer.Effect
  >(contextPanelReducer, () => createInitialContextPanelState(init()), {
    "store-toggle": (_state, effect) => {
      writeStored(
        REMEMBERED_TOGGLE_STORAGE_KEYS[effect.toggle],
        String(effect.on)
      );
    },
    "store-disabled-links": (_state, effect) => {
      writeStored(LINKS_DISABLED_STORAGE_KEY, JSON.stringify(effect.linkIds));
    },
    "read-video-file": (_state, effect, dispatch) => {
      fetch(
        `/api/video-files/read?videoId=${effect.videoId}&path=${encodeURIComponent(effect.path)}`
      )
        .then(async (response) => {
          if (!response.ok) {
            dispatch({ type: "video-file-read-failed", path: effect.path });
            return;
          }
          dispatch({
            type: "video-file-read",
            path: effect.path,
            content: await response.text(),
          });
        })
        .catch((error) => {
          console.error("Failed to read file:", error);
          dispatch({ type: "video-file-read-failed", path: effect.path });
        });
    },
  });

  const onModalOpenChange = useMemo(() => {
    const dismiss = (modal: contextPanelReducer.Modal) => (open: boolean) => {
      if (!open) dispatch({ type: "modal-dismissed", modal });
    };
    return {
      "preview-file": dismiss("preview-file"),
      "add-link": dismiss("add-link"),
      "edit-file": dismiss("edit-file"),
      "paste-file": dismiss("paste-file"),
      "delete-file": dismiss("delete-file"),
    };
  }, [dispatch]);

  return { state, dispatch, onModalOpenChange };
}
