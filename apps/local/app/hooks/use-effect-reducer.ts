import { useCallback, useEffect, useReducer, useState } from "react";
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
 * `useEffectReducer` from `use-effect-reducer` 0.7.0, with the same API and
 * types, fixed for StrictMode (#2386). Import it from here: importing it from
 * the package is a lint error.
 *
 * The package's version had two StrictMode bugs, both in how it treated
 * StrictMode's second run of the mount effects:
 *
 * 1. After starting the queued effects it dropped the first `count` batches
 *    of the queue by position. A function initial state queues a batch, so
 *    that flush ran on mount, and its replay dropped whichever batch an event
 *    dispatched on mount had queued in between. That effect never ran (the
 *    SEO Description modal sat on Loading…). Here a flush names the batches
 *    it handled and removes those, so its replay removes nothing new.
 * 2. StrictMode's simulated unmount stopped the effects the initializer
 *    declared, and the remount never started them again. Here the unmount
 *    suspends, and the remount restarts, the effects whose handler
 *    returned a cleanup. One that returned none was done once it ran, and
 *    does not run again (#2718).
 *
 * So both forms of initial state, an object or `(exec) => state`, are safe.
 */
export function useEffectReducer<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent> = EffectObject<TState, TEvent>,
>(
  effectReducer: EffectReducer<TState, TEvent, TEffect>,
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>,
  effectsMap?: EffectsMap<TState, TEvent, TEffect>
): [TState, React.Dispatch<TEvent | TEvent["type"]>] {
  const [runningEffects] = useState(() =>
    createRunningEffects<TState, TEvent>()
  );

  const wrappedReducer = (
    current: Internal<TState, TEvent>,
    event: TEvent | FlushEvent<TState, TEvent>
  ): Internal<TState, TEvent> => {
    if (isFlush(event)) {
      return {
        state: current.state,
        queue: current.queue.filter((batch) => !event.batches.includes(batch)),
        toStop: current.toStop.filter(
          (entity) => !event.stopped.includes(entity)
        ),
      };
    }
    const { exec, queued, stopped } = createExec(effectsMap);
    const state = effectReducer(current.state, event, exec);
    return {
      state,
      queue: queued.length
        ? [...current.queue, { state, entities: queued }]
        : current.queue,
      toStop: stopped.length ? [...current.toStop, ...stopped] : current.toStop,
    };
  };

  const [{ state, queue, toStop }, dispatch] = useReducer(
    wrappedReducer,
    undefined,
    (): Internal<TState, TEvent> => ({
      ...resolveInitialState(initialState, effectsMap),
      toStop: [],
    })
  );

  const eventDispatch = dispatch as React.Dispatch<TEvent>;
  const wrappedDispatch = useCallback(
    (event: TEvent | TEvent["type"]) =>
      eventDispatch(
        typeof event === "string" ? ({ type: event } as TEvent) : event
      ),
    [eventDispatch]
  );

  // Stop the effects marked for disposal, then start the queued ones, then
  // flush exactly what was handled here.
  useEffect(() => {
    if (!queue.length && !toStop.length) return;
    runningEffects.run(toStop, queue, eventDispatch);
    dispatch({ type: FLUSH, batches: queue, stopped: toStop });
  }, [queue, toStop, eventDispatch, runningEffects]);

  // Unmount suspends every running effect (one with a cleanup). A remount
  // of the same instance (StrictMode's second pass) starts again the ones
  // the unmount suspended.
  useEffect(() => {
    runningEffects.restartSuspended();
    return () => runningEffects.suspendAll();
  }, [runningEffects]);

  return [state, wrappedDispatch];
}

type Internal<TState, TEvent extends EventObject> = {
  state: TState;
  /** Batches of effects declared and not yet started, in order. */
  queue: Batch<TState, TEvent>[];
  toStop: Entity<TState, TEvent>[];
};

const FLUSH = Symbol("flush");
type FlushEvent<TState, TEvent extends EventObject> = {
  type: typeof FLUSH;
  batches: Batch<TState, TEvent>[];
  stopped: Entity<TState, TEvent>[];
};

const isFlush = <TState, TEvent extends EventObject>(
  event: TEvent | FlushEvent<TState, TEvent>
): event is FlushEvent<TState, TEvent> => event.type === FLUSH;
