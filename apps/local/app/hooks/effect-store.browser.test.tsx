import { act, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EffectReducer } from "use-effect-reducer";
import { afterEach, expect, it } from "vitest";
import {
  createEffectStore,
  useEffectStore,
  useSelector,
  type EffectStore,
} from "./effect-store";

/**
 * Rendered under StrictMode, as the app is: it runs every mount effect twice
 * and every initializer twice, which is where effects used to go missing
 * (#2386).
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type State = {
  status: "idle" | "loading" | "loaded";
  ticks: number;
  label: string;
};
type Action =
  | { type: "opened" }
  | { type: "loaded" }
  | { type: "ticked" }
  | { type: "relabelled"; label: string }
  | { type: "ignored" };
type Effect = { type: "load" } | { type: "tick" };

const reducer: EffectReducer<State, Action, Effect> = (state, action, exec) => {
  switch (action.type) {
    case "opened":
      // Loads once per mount, so StrictMode's second "opened" declares nothing.
      if (state.status !== "idle") return state;
      exec({ type: "load" });
      return { ...state, status: "loading" };
    case "loaded":
      return { ...state, status: "loaded" };
    case "ticked":
      return { ...state, ticks: state.ticks + 1 };
    case "relabelled":
      return { ...state, label: action.label };
    case "ignored":
      return state;
  }
};

const initial: State = { status: "idle", ticks: 0, label: "a" };

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
  let seen: State["status"] | undefined;
  function Modal() {
    const store = useEffectStore(reducer, (): State => initial, {
      load: (_state, _effect, dispatch) => dispatch({ type: "loaded" }),
      tick: () => {},
    });
    useEffect(() => store.dispatch({ type: "opened" }), [store]);
    seen = useSelector(store, (s) => s.status);
    return null;
  }

  render(<Modal />);

  expect(seen).toBe("loaded");
});

it("keeps an effect declared by the initializer running once after StrictMode's remount", () => {
  const running = new Set<number>();
  let next = 0;
  function Ticker() {
    useEffectStore(
      reducer,
      (exec): State => {
        exec({ type: "tick" });
        return initial;
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

it("runs an effect declared after mount exactly once under StrictMode", () => {
  let loads = 0;
  let store: EffectStore<State, Action> | undefined;
  function Surface() {
    store = useEffectStore(reducer, initial, {
      load: () => {
        loads++;
      },
      tick: () => {},
    });
    return null;
  }

  render(<Surface />);
  act(() => store!.dispatch({ type: "opened" }));

  expect(loads).toBe(1);
});

it("re-renders a component only when its slice changes", () => {
  const { store } = createEffectStore(reducer, initial);
  const renders = { ticks: 0, label: 0 };
  function Ticks() {
    renders.ticks++;
    return <>{useSelector(store, (s) => s.ticks)}</>;
  }
  function Label() {
    renders.label++;
    return <>{useSelector(store, (s) => s.label)}</>;
  }
  render(
    <>
      <Ticks />
      <Label />
    </>
  );
  const afterMount = { ...renders };

  act(() => store.dispatch({ type: "ticked" }));
  act(() => store.dispatch({ type: "ignored" }));
  act(() => store.dispatch({ type: "relabelled", label: "a" }));

  // StrictMode renders twice per render.
  expect(renders.ticks - afterMount.ticks).toBe(2);
  expect(renders.label - afterMount.label).toBe(0);
});

it("keeps the previous slice while isEqual says it is the same", () => {
  const { store } = createEffectStore(reducer, initial);
  let renders = 0;
  let seen: { label: string } | undefined;
  function Label() {
    renders++;
    seen = useSelector(
      store,
      (s) => ({ label: s.label }),
      (a, b) => a.label === b.label
    );
    return null;
  }
  render(<Label />);
  const first = seen;
  const afterMount = renders;

  act(() => store.dispatch({ type: "ticked" }));
  expect(renders).toBe(afterMount);
  expect(seen).toBe(first);

  act(() => store.dispatch({ type: "relabelled", label: "b" }));
  expect(seen).toEqual({ label: "b" });
});

it("re-reads a selector that closes over a changed prop", () => {
  const { store } = createEffectStore(reducer, initial);
  let seen: boolean | undefined;
  function IsLabel(props: { label: string }) {
    seen = useSelector(store, (s) => s.label === props.label);
    return null;
  }
  render(<IsLabel label="a" />);
  expect(seen).toBe(true);
  act(() =>
    root!.render(
      <StrictMode>
        <IsLabel label="b" />
      </StrictMode>
    )
  );
  expect(seen).toBe(false);
});

it("hands out the same store, and so the same dispatch, on every render", () => {
  const stores = new Set<EffectStore<State, Action>>();
  function Surface() {
    const store = useEffectStore(reducer, initial);
    stores.add(store);
    useSelector(store, (s) => s.ticks);
    return null;
  }
  render(<Surface />);
  const [store] = stores;
  act(() => store!.dispatch({ type: "ticked" }));

  expect(stores.size).toBe(1);
});
