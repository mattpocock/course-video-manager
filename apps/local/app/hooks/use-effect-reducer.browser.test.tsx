import { act, Activity, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import { afterEach, expect, it } from "vitest";
import { useEffectReducer } from "./use-effect-reducer";

/**
 * Every test renders under StrictMode, as the app does: it runs every mount
 * effect twice, which is what used to lose effects here (#2386).
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type State = { status: "idle" | "loading" | "loaded" };
type Action = { type: "opened" } | { type: "loaded" };
type Effect = { type: "load" } | { type: "tick" };

const reducer: EffectReducer<State, Action, Effect> = (state, action, exec) => {
  switch (action.type) {
    case "opened":
      // Loads once per mount, so StrictMode's second "opened" declares nothing.
      if (state.status !== "idle") return state;
      exec({ type: "load" });
      return { status: "loading" };
    case "loaded":
      return { status: "loaded" };
  }
};

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

const render = (element: ReactNode) => {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<StrictMode>{element}</StrictMode>));
};

it("runs the effect of an event dispatched on mount, with a function initial state", () => {
  let seen: State | undefined;
  function Modal() {
    const [state, dispatch] = useEffectReducer(
      reducer,
      (): State => ({ status: "idle" }),
      {
        load: (_state, _effect, dispatch) => dispatch({ type: "loaded" }),
        tick: () => {},
      }
    );
    useEffect(() => dispatch({ type: "opened" }), [dispatch]);
    seen = state;
    return null;
  }

  render(<Modal />);

  expect(seen).toEqual({ status: "loaded" });
});

it("keeps an effect declared by the initializer running after StrictMode's remount", () => {
  const running = new Set<number>();
  let next = 0;
  function Ticker() {
    useEffectReducer(
      reducer,
      (exec): State => {
        exec({ type: "tick" });
        return { status: "idle" };
      },
      {
        load: () => {},
        tick: () => {
          const id = next++;
          running.add(id);
          return () => running.delete(id);
        },
      }
    );
    return null;
  }

  render(<Ticker />);
  expect(running.size).toBe(1);

  act(() => root!.unmount());
  root = undefined;
  expect(running.size).toBe(0);
});

it("runs an initializer's one-shot effect once under StrictMode's remount", () => {
  let loads = 0;
  function Loader() {
    useEffectReducer(
      reducer,
      (exec): State => {
        exec({ type: "load" });
        return { status: "loading" };
      },
      {
        // Stands in for a fetch: it returns no cleanup, so it is done once run.
        load: () => {
          loads++;
        },
        tick: () => {},
      }
    );
    return null;
  }

  render(<Loader />);

  expect(loads).toBe(1);
});

it("does not restart an effect stopped while its effects were unmounted", () => {
  type TickState = { ticking: EffectEntity<TickState, TickAction> | null };
  type TickAction = { type: "tick-started" } | { type: "tick-stopped" };
  const tickReducer: EffectReducer<TickState, TickAction, { type: "tick" }> = (
    state,
    action,
    exec
  ) => {
    switch (action.type) {
      case "tick-started":
        return { ticking: exec({ type: "tick" }) };
      case "tick-stopped":
        if (state.ticking) exec.stop(state.ticking);
        return { ticking: null };
    }
  };
  const running = new Set<number>();
  let next = 0;
  let dispatch: React.Dispatch<TickAction> | undefined;
  function Ticker() {
    [, dispatch] = useEffectReducer(
      tickReducer,
      { ticking: null },
      {
        tick: () => {
          const id = next++;
          running.add(id);
          return () => running.delete(id);
        },
      }
    );
    return null;
  }
  const show = (mode: "visible" | "hidden") =>
    act(() =>
      root!.render(
        <StrictMode>
          <Activity mode={mode}>
            <Ticker />
          </Activity>
        </StrictMode>
      )
    );

  render(null);
  show("visible");
  act(() => dispatch!({ type: "tick-started" }));
  expect(running.size).toBe(1);

  // Hiding unmounts the effects but keeps the state, so the stop lands
  // while they are unmounted, and showing it again remounts them.
  show("hidden");
  act(() => dispatch!({ type: "tick-stopped" }));
  show("visible");

  expect(running.size).toBe(0);
});
