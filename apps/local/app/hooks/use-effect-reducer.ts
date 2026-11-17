import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  EffectFunction,
  EffectObject,
  EffectReducer,
  EffectReducerExec,
  EffectsMap,
  EventObject,
  InitialEffectStateGetter,
} from "use-effect-reducer";
import {
  IDLE,
  isInitializer,
  STARTED,
  toEntity as toEffectEntity,
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
 *    declared, and the remount never started them again. Here the remount
 *    restarts whatever the unmount stopped.
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
  const startedRef = useRef(new Set<Entity<TState, TEvent>>());
  const suspendedRef = useRef<Entity<TState, TEvent>[]>([]);

  const toEntity = (
    effect: TEffect | EffectFunction<TState, TEvent, TEffect>
  ): Entity<TState, TEvent> => toEffectEntity(effect, effectsMap);

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
    const queued: Entity<TState, TEvent>[] = [];
    const toStop: Entity<TState, TEvent>[] = [];
    const exec = ((
      effect: TEffect | EffectFunction<TState, TEvent, TEffect>
    ) => {
      const entity = toEntity(effect);
      queued.push(entity);
      return entity;
    }) as unknown as EffectReducerExec<TState, TEvent, TEffect>;
    exec.stop = (entity) => {
      toStop.push(entity as Entity<TState, TEvent>);
    };
    exec.replace = (entity, effect) => {
      if (entity) toStop.push(entity as Entity<TState, TEvent>);
      return exec(effect);
    };
    const state = effectReducer(current.state, event, exec);
    return {
      state,
      queue: queued.length
        ? [...current.queue, { state, entities: queued }]
        : current.queue,
      toStop: toStop.length ? [...current.toStop, ...toStop] : current.toStop,
    };
  };

  const [{ state, queue, toStop }, dispatch] = useReducer(
    wrappedReducer,
    undefined,
    (): Internal<TState, TEvent> => {
      if (!isInitializer(initialState)) {
        return { state: initialState, queue: [], toStop: [] };
      }
      const entities: Entity<TState, TEvent>[] = [];
      const resolved = initialState((effect) => {
        const entity = toEntity(effect);
        entities.push(entity);
        return entity;
      });
      return {
        state: resolved,
        queue: entities.length ? [{ state: resolved, entities }] : [],
        toStop: [],
      };
    }
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
    for (const entity of toStop) {
      entity.stop();
      startedRef.current.delete(entity);
    }
    for (const batch of queue) {
      for (const entity of batch.entities) {
        if (entity.status !== IDLE) continue;
        startedRef.current.add(entity);
        entity.start(batch.state, eventDispatch);
      }
    }
    dispatch({ type: FLUSH, batches: queue, stopped: toStop });
  }, [queue, toStop, eventDispatch]);

  // Unmount stops every running effect. A remount of the same instance
  // (StrictMode's second pass) starts again the ones the unmount stopped.
  useEffect(() => {
    for (const entity of suspendedRef.current) entity.restart();
    suspendedRef.current = [];
    const started = startedRef.current;
    return () => {
      for (const entity of started) {
        if (entity.status !== STARTED) continue;
        entity.stop();
        suspendedRef.current.push(entity);
      }
    };
  }, []);

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
