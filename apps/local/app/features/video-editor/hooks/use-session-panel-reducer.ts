import { useEffect } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { getActiveDiagramId } from "@/lib/diagram-window";
import { browserFocus, diagramFocus } from "@/lib/focus-tracker";
import {
  createInitialSessionPanelState,
  sessionPanelReducer,
} from "../session-panel-reducer";
import { nowMs, every } from "@/packages/clock";

const activeDiagramOpen = () => getActiveDiagramId() !== null;

/**
 * A Recording Session panel's effect runner for `sessionPanelReducer`, and
 * the bridges that report its session, the clock and the two focus trackers.
 */
export function useSessionPanelReducer(session: {
  isRecording: boolean;
  startedAt: number;
}) {
  const [state, dispatch] = useEffectReducer<
    sessionPanelReducer.State,
    sessionPanelReducer.Action,
    sessionPanelReducer.Effect
  >(
    sessionPanelReducer,
    (exec) =>
      createInitialSessionPanelState(
        {
          recording: session.isRecording,
          startedAt: session.startedAt,
          at: nowMs(),
          activeDiagramOpen: activeDiagramOpen(),
          diagramFocused: diagramFocus.isFocused(),
          browserFocused: browserFocus.isFocused(),
        },
        exec
      ),
    {
      "tick-every-second": (_state, _effect, dispatch) => {
        const interval = every(1000, () =>
          dispatch({
            type: "clock-ticked",
            at: nowMs(),
            activeDiagramOpen: activeDiagramOpen(),
          })
        );
        return () => interval();
      },
    }
  );

  useEffect(() => {
    dispatch({
      type: "session-heard",
      recording: session.isRecording,
      startedAt: session.startedAt,
      at: nowMs(),
      activeDiagramOpen: activeDiagramOpen(),
    });
  }, [session.isRecording, session.startedAt, dispatch]);

  useEffect(() => {
    dispatch({
      type: "diagram-focus-changed",
      focused: diagramFocus.isFocused(),
    });
    return diagramFocus.subscribe((focused) =>
      dispatch({ type: "diagram-focus-changed", focused })
    );
  }, [dispatch]);

  useEffect(() => {
    dispatch({
      type: "browser-focus-changed",
      focused: browserFocus.isFocused(),
    });
    return browserFocus.subscribe((focused) =>
      dispatch({ type: "browser-focus-changed", focused })
    );
  }, [dispatch]);

  return state;
}
