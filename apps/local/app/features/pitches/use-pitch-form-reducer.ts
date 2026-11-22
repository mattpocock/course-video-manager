import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { toast } from "@/components/ui/toast";
import {
  createInitialPitchFormState,
  pitchFormReducer,
  selectWaitingSave,
} from "./pitch-form-reducer";
import { after } from "@/packages/clock";

/** How long typing must pause before an edit saves. */
const EDIT_PAUSE_MS = 600;
/** How long Saved shows once everything has landed. */
const SAVED_SHOWN_MS = 1200;

const savePitchField = (save: pitchFormReducer.Save) => {
  const body = new FormData();
  body.set("field", save.field);
  body.set("value", save.value);
  return fetch(`/api/pitches/${save.pitchId}/update`, {
    method: "POST",
    body,
    // A save sent as the page is left must still arrive.
    keepalive: true,
  });
};

/** The Pitch page's effect runner for `pitchFormReducer`. */
export function usePitchFormReducer(fields: pitchFormReducer.Fields) {
  const revalidator = useRevalidator();

  const [state, dispatch] = useEffectReducer<
    pitchFormReducer.State,
    pitchFormReducer.Action,
    pitchFormReducer.Effect
  >(pitchFormReducer, createInitialPitchFormState(fields), {
    "wait-for-edit-pause": (_state, effect, dispatch) => {
      const cancelTimer = after(EDIT_PAUSE_MS, () =>
        dispatch({ type: "edit-pause-elapsed", editId: effect.editId })
      );
      return cancelTimer;
    },
    "save-pitch-field": (_state, effect, dispatch) => {
      savePitchField(effect)
        .then((res) =>
          dispatch({
            type: res.ok ? "pitch-field-saved" : "pitch-field-save-failed",
          })
        )
        .catch(() => dispatch({ type: "pitch-field-save-failed" }));
    },
    "reload-pitch": () => {
      void revalidator.revalidate();
    },
    "wait-before-hiding-saved": (_state, effect, dispatch) => {
      const cancelTimer = after(SAVED_SHOWN_MS, () =>
        dispatch({ type: "saved-shown-elapsed", editId: effect.editId })
      );
      return cancelTimer;
    },
    "show-error": (_state, effect) => {
      toast.error(effect.message);
    },
  });

  // Bridge: leaving the page. Its pause timer is cleared as it unmounts, so
  // the edit still waiting on it is sent here.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () => () => {
      const waiting = selectWaitingSave(stateRef.current);
      if (!waiting) return;
      savePitchField(waiting).catch(() => {
        toast.error("Couldn't save the Pitch");
      });
    },
    []
  );

  return { state, dispatch };
}
