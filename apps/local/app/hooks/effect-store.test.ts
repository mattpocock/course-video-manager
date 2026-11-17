import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import { describe, expect, it } from "vitest";
import { createEffectStore } from "./effect-store";

type State = { count: number; ticking: EffectEntity<State, Event> | null };
type Event =
  | { type: "bumped" }
  | { type: "ignored" }
  | { type: "ignored-with-effect" }
  | { type: "pair-requested" }
  | { type: "answered"; from: string }
  | { type: "tick-started" }
  | { type: "tick-replaced" }
  | { type: "tick-stopped" };
type Effect =
  | { type: "log"; label: string }
  | { type: "ask"; label: string }
  | { type: "tick"; label: string };

const reducer: EffectReducer<State, Event, Effect> = (state, event, exec) => {
  switch (event.type) {
    case "bumped":
      return { ...state, count: state.count + 1 };
    case "ignored":
      return state;
    case "ignored-with-effect":
      exec({ type: "log", label: "ignored" });
      return state;
    case "pair-requested":
      exec({ type: "ask", label: "first" });
      exec({ type: "log", label: "second" });
      return { ...state, count: state.count + 1 };
    case "answered":
      exec({ type: "log", label: `answer to ${event.from}` });
      return { ...state, count: state.count + 10 };
    case "tick-started":
      return { ...state, ticking: exec({ type: "tick", label: "a" }) };
    case "tick-replaced":
      return {
        ...state,
        ticking: exec.replace(state.ticking!, { type: "tick", label: "b" }),
      };
    case "tick-stopped":
      exec.stop(state.ticking!);
      return { ...state, ticking: null };
  }
};

const setup = () => {
  const log: string[] = [];
  const runner = createEffectStore(
    reducer,
    { count: 0, ticking: null },
    {
      log: (state, effect) => {
        log.push(`${effect.label} (count ${state.count})`);
      },
      ask: (state, effect, dispatch) => {
        log.push(`${effect.label} (count ${state.count})`);
        dispatch({ type: "answered", from: effect.label });
        log.push(`${effect.label} returned`);
      },
      tick: (_state, effect) => {
        log.push(`start ${effect.label}`);
        return () => log.push(`stop ${effect.label}`);
      },
    }
  );
  return { log, ...runner };
};

describe("createEffectStore: notifying", () => {
  it("notifies subscribers once per event that changes the state", () => {
    const { store } = setup();
    let notified = 0;
    store.subscribe(() => notified++);

    store.dispatch({ type: "bumped" });
    store.dispatch("bumped");

    expect(notified).toBe(2);
    expect(store.getSnapshot().count).toBe(2);
  });

  it("never notifies for an ignored event, but still runs its effects", () => {
    const { store, mount, log } = setup();
    mount();
    let notified = 0;
    store.subscribe(() => notified++);
    const before = store.getSnapshot();

    store.dispatch({ type: "ignored" });
    store.dispatch({ type: "ignored-with-effect" });

    expect(notified).toBe(0);
    expect(store.getSnapshot()).toBe(before);
    expect(log).toEqual(["ignored (count 0)"]);
  });

  it("stops notifying an unsubscribed listener", () => {
    const { store } = setup();
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);
    store.dispatch({ type: "bumped" });
    unsubscribe();
    store.dispatch({ type: "bumped" });
    expect(notified).toBe(1);
  });
});

describe("createEffectStore: running effects", () => {
  it("runs to completion: an event a handler dispatches waits for the rest of its batch", () => {
    const { store, mount, log } = setup();
    mount();

    store.dispatch({ type: "pair-requested" });

    expect(log).toEqual([
      "first (count 1)",
      "first returned",
      // The answer's reducer has not run yet: the batch finishes first.
      "second (count 1)",
      "answer to first (count 11)",
    ]);
    expect(store.getSnapshot().count).toBe(11);
  });

  it("holds effects declared before mount, and starts them on mount in order", () => {
    const { store, mount, log } = setup();

    store.dispatch({ type: "ignored-with-effect" });
    store.dispatch({ type: "bumped" });
    store.dispatch({ type: "ignored-with-effect" });
    expect(log).toEqual([]);

    mount();
    expect(log).toEqual(["ignored (count 0)", "ignored (count 1)"]);
  });

  it("stops a replaced effect before starting its replacement, and runs cleanups", () => {
    const { store, mount, log } = setup();
    mount();

    store.dispatch({ type: "tick-started" });
    store.dispatch({ type: "tick-replaced" });
    store.dispatch({ type: "tick-stopped" });

    expect(log).toEqual(["start a", "stop a", "start b", "stop b"]);
  });

  it("stops running effects on unmount and restarts them on remount", () => {
    const { store, mount, log } = setup();
    const unmount = mount();
    store.dispatch({ type: "tick-started" });

    unmount();
    expect(log).toEqual(["start a", "stop a"]);

    mount();
    expect(log).toEqual(["start a", "stop a", "start a"]);
  });

  it("does not run a finished one-shot effect again on remount", () => {
    const { store, mount, log } = setup();
    const unmount = mount();
    store.dispatch({ type: "ignored-with-effect" });
    store.dispatch({ type: "tick-started" });

    unmount();
    mount();

    // The log returned no cleanup, so it was done once it ran; only the
    // tick, which did, is stopped and started again.
    expect(log).toEqual(["ignored (count 0)", "start a", "stop a", "start a"]);
  });

  it("does not restart an effect stopped while unmounted", () => {
    const { store, mount, log } = setup();
    const unmount = mount();
    store.dispatch({ type: "tick-started" });

    unmount();
    store.dispatch({ type: "tick-stopped" });
    mount();

    expect(log).toEqual(["start a", "stop a"]);
  });

  it("runs an initializer's effects on mount, once", () => {
    const log: string[] = [];
    const { mount } = createEffectStore(
      reducer,
      (exec) => {
        exec({ type: "log", label: "init" });
        return { count: 0, ticking: null };
      },
      {
        log: (_state, effect) => {
          log.push(effect.label);
        },
        ask: () => {},
        tick: () => {},
      }
    );
    expect(log).toEqual([]);
    mount();
    expect(log).toEqual(["init"]);
  });

  it("uses the latest effect handlers it was given", () => {
    const { store, mount, setEffectsMap } = setup();
    mount();
    const seen: string[] = [];
    setEffectsMap({
      log: (_state, effect) => {
        seen.push(effect.label);
      },
      ask: () => {},
      tick: () => {},
    });
    store.dispatch({ type: "ignored-with-effect" });
    expect(seen).toEqual(["ignored"]);
  });
});
