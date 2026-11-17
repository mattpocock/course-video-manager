import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  EffectObject,
  EffectReducer,
  EffectsMap,
  EventObject,
  InitialEffectStateGetter,
} from "use-effect-reducer";
import {
  createExec,
  createRunningEffects,
  resolveInitialState,
  type Batch,
  type Entity,
} from "./effect-entity";

/**
 * A reducer surface's state, outside React (docs/FRONTEND_STATE.md). The
 * same pure reducer and the same effects as `useEffectReducer`, but a
 * component reads it through `useSelector` and re-renders only when its own
 * slice changes. `dispatch` is the same function for the surface's life.
 */
export type EffectStore<
  TState,
  TEvent extends EventObject,
> = ReadableStore<TState> & {
  dispatch: (event: TEvent | TEvent["type"]) => void;
};

/** What `useSelector` needs of a store. */
export type ReadableStore<TState> = {
  getSnapshot: () => TState;
  /** Called after each event that changed the state; never for one that did not. */
  subscribe: (listener: () => void) => () => void;
};

/**
 * The store, and what its owner does with it: `mount` starts its effects
 * (and returns the unmount), `setEffectsMap` hands it the latest handlers.
 * `useEffectStore` does both; a test calls them directly.
 */
export type EffectStoreRunner<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
> = {
  store: EffectStore<TState, TEvent>;
  mount: () => () => void;
  setEffectsMap: (
    effectsMap: EffectsMap<TState, TEvent, TEffect> | undefined
  ) => void;
};

/**
 * Effects run as `useEffectReducer` runs them: in the order they were
 * declared, a batch (one event's effects) at a time, each with the state its
 * event produced, and an event's stops before any start. `exec.stop` and
 * `exec.replace` cancel, and a handler's cleanup runs when it stops.
 *
 * The difference is when. `useEffectReducer` starts them after React
 * commits, which costs a commit of its own; the store starts them right
 * after the event's state is published, without rendering. Run to
 * completion: an event a handler dispatches synchronously waits until every
 * effect before it has started, and never runs inside another event.
 *
 * Effects start only while mounted. Unmount suspends the running ones (those
 * whose handler returned a cleanup) and a remount (StrictMode's second pass)
 * starts them again, as in `useEffectReducer` (#2386). One without a cleanup
 * is done once it has run, and is not run again (#2718).
 */
export function createEffectStore<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent> = EffectObject<TState, TEvent>,
>(
  reducer: EffectReducer<TState, TEvent, TEffect>,
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>,
  effectsMap?: EffectsMap<TState, TEvent, TEffect>
): EffectStoreRunner<TState, TEvent, TEffect> {
  let effects = effectsMap;
  const initial = resolveInitialState(initialState, effects);
  let state = initial.state;
  /** Batches declared and not yet started, in order. */
  let queue: Batch<TState, TEvent>[] = initial.queue;
  let toStop: Entity<TState, TEvent>[] = [];
  const runningEffects = createRunningEffects<TState, TEvent>();
  let mounted = false;
  const listeners = new Set<() => void>();
  const inbox: TEvent[] = [];
  let running = false;

  const startEffects = () => {
    if (!mounted) return;
    const stopping = toStop;
    const batches = queue;
    toStop = [];
    queue = [];
    runningEffects.run(stopping, batches, send);
  };

  const step = (event: TEvent) => {
    const { exec, queued, stopped } = createExec(effects);
    const next = reducer(state, event, exec);
    toStop.push(...stopped);
    if (queued.length) queue.push({ state: next, entities: queued });
    if (Object.is(next, state)) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** Runs `work`, then every event it (or an effect) dispatched, in order. */
  const toCompletion = (work: () => void) => {
    if (running) {
      work();
      return;
    }
    running = true;
    try {
      work();
      startEffects();
      while (inbox.length) {
        step(inbox.shift()!);
        startEffects();
      }
    } finally {
      running = false;
    }
  };

  function send(event: TEvent) {
    inbox.push(event);
    if (!running) toCompletion(() => {});
  }

  const store: EffectStore<TState, TEvent> = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (event) =>
      send(typeof event === "string" ? ({ type: event } as TEvent) : event),
  };

  return {
    store,
    setEffectsMap: (next) => {
      effects = next;
    },
    mount: () => {
      toCompletion(() => {
        mounted = true;
        // As `useEffectReducer`: what was queued first, then what the last
        // unmount suspended.
        startEffects();
        runningEffects.restartSuspended();
      });
      return () => {
        mounted = false;
        runningEffects.suspendAll();
      };
    },
  };
}

/**
 * A surface's store, created once for the component's life, with its
 * effects running while it is mounted. Takes `useEffectReducer`'s
 * arguments. The reducer and initial state are read once; the effect
 * handlers are the latest render's, so they may close over props.
 */
export function useEffectStore<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent> = EffectObject<TState, TEvent>,
>(
  reducer: EffectReducer<TState, TEvent, TEffect>,
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>,
  effectsMap?: EffectsMap<TState, TEvent, TEffect>
): EffectStore<TState, TEvent> {
  const [runner] = useState(() =>
    createEffectStore(reducer, initialState, effectsMap)
  );
  useLayoutEffect(() => runner.setEffectsMap(effectsMap));
  useEffect(() => runner.mount(), [runner]);
  return runner.store;
}

/**
 * A slice of a store's state. The component re-renders only when the slice
 * changes by `isEqual`. Select what the component shows, never the whole
 * state: `scripts/check-frontend-state.ts` fails `(state) => state`.
 *
 * The selector may close over props; an inline one is fine. A selector that
 * builds a new object or array each time needs an `isEqual` that compares
 * its contents, or it re-renders on every change to the store.
 */
export function useSelector<TState, TSlice>(
  store: ReadableStore<TState>,
  selector: (state: TState) => TSlice,
  isEqual: (a: TSlice, b: TSlice) => boolean = Object.is
): TSlice {
  // The slice last rendered, so a selector rebuilt by a render keeps it
  // while it stays equal.
  const committed = useRef<{ slice: TSlice } | null>(null);
  const getSlice = useMemo(() => {
    let memo: { state: TState; slice: TSlice } | null = null;
    return () => {
      const state = store.getSnapshot();
      if (memo && Object.is(memo.state, state)) return memo.slice;
      const slice = selector(state);
      const previous = memo ?? committed.current;
      memo = {
        state,
        slice:
          previous && isEqual(previous.slice, slice) ? previous.slice : slice,
      };
      return memo.slice;
    };
  }, [store, selector, isEqual]);
  const slice = useSyncExternalStore(store.subscribe, getSlice, getSlice);
  useEffect(() => {
    committed.current = { slice };
  }, [slice]);
  return slice;
}
