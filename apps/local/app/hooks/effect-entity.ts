import type {
  EffectEntity,
  EffectFunction,
  EffectObject,
  EffectReducerExec,
  EffectsMap,
  EventObject,
  InitialEffectStateGetter,
} from "use-effect-reducer";

/**
 * The effect runner both `useEffectReducer` (`use-effect-reducer.ts`) and
 * the effect store (`effect-store.ts`) use: how an effect is declared, how a
 * batch stops then starts, and how an unmount suspends what runs and a
 * remount (StrictMode's second pass, #2386) restarts it. Each runner only
 * decides WHEN these run: after React commits, or right after a dispatch.
 */

/** One declared effect. */
export type Entity<TState, TEvent extends EventObject> = EffectEntity<
  TState,
  TEvent
> & { restart: () => void };

type Status = EffectEntity<unknown, EventObject>["status"];
const IDLE = 0 as Status;
const STARTED = 1 as Status;
const STOPPED = 2 as Status;

/** The effects one event declared, with the state that event produced. */
export type Batch<TState, TEvent extends EventObject> = {
  state: TState;
  entities: Entity<TState, TEvent>[];
};

type AnyEffectFunction<TState, TEvent extends EventObject> = EffectFunction<
  TState,
  TEvent,
  EffectObject<TState, TEvent>
>;
type EffectFunctions<TState, TEvent extends EventObject> = Record<
  string,
  AnyEffectFunction<TState, TEvent>
>;
type ResolvedEffect<TState, TEvent extends EventObject> = EffectObject<
  TState,
  TEvent
> & { exec?: AnyEffectFunction<TState, TEvent> };

function toEffectObject<TState, TEvent extends EventObject>(
  effect: EffectObject<TState, TEvent> | AnyEffectFunction<TState, TEvent>,
  effectsMap: EffectFunctions<TState, TEvent> | undefined
): ResolvedEffect<TState, TEvent> {
  if (typeof effect === "function") {
    return { type: effect.name, exec: effectsMap?.[effect.name] ?? effect };
  }
  return { ...effect, exec: effectsMap?.[effect.type] ?? effect.exec };
}

function createEntity<TState, TEvent extends EventObject>(
  effect: ResolvedEffect<TState, TEvent>
): Entity<TState, TEvent> {
  let cleanup: (() => void) | void;
  let startedWith: [TState, React.Dispatch<TEvent>] | undefined;
  const entity: Entity<TState, TEvent> = {
    type: effect.type,
    status: IDLE,
    start: (state, dispatch) => {
      startedWith = [state, dispatch];
      cleanup = effect.exec?.(state, effect, dispatch);
      entity.status = STARTED;
    },
    stop: () => {
      if (entity.status === STARTED && typeof cleanup === "function") {
        cleanup();
      }
      cleanup = undefined;
      entity.status = STOPPED;
    },
    restart: () => {
      if (startedWith) entity.start(...startedWith);
    },
  };
  return entity;
}

/** The entity for an effect `exec` was given, its handler from `effectsMap`. */
const toEntity = <
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
>(
  effect: TEffect | EffectFunction<TState, TEvent, TEffect>,
  effectsMap: EffectsMap<TState, TEvent, TEffect> | undefined
): Entity<TState, TEvent> =>
  createEntity(
    toEffectObject<TState, TEvent>(
      effect as
        EffectObject<TState, TEvent> | AnyEffectFunction<TState, TEvent>,
      effectsMap as EffectFunctions<TState, TEvent> | undefined
    )
  );

/**
 * The `exec` one reducer step is given, and what the step asked of it:
 * the effects it declared (`queued`) and the ones it stopped or replaced
 * (`stopped`), each in order.
 */
export function createExec<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
>(
  effectsMap: EffectsMap<TState, TEvent, TEffect> | undefined
): {
  exec: EffectReducerExec<TState, TEvent, TEffect>;
  queued: Entity<TState, TEvent>[];
  stopped: Entity<TState, TEvent>[];
} {
  type Exec = EffectReducerExec<TState, TEvent, TEffect>;
  const queued: Entity<TState, TEvent>[] = [];
  const stopped: Entity<TState, TEvent>[] = [];
  const run = (effect: Parameters<Exec>[0]) => {
    const entity = toEntity(effect, effectsMap);
    queued.push(entity);
    return entity;
  };
  const exec: Exec = Object.assign(run, {
    stop: (entity: Parameters<Exec["stop"]>[0]) => {
      stopped.push(entity as Entity<TState, TEvent>);
    },
    replace: (
      entity: Parameters<Exec["replace"]>[0],
      effect: Parameters<Exec["replace"]>[1]
    ) => {
      if (entity) stopped.push(entity as Entity<TState, TEvent>);
      return run(effect);
    },
  });
  return { exec, queued, stopped };
}

/**
 * The initial state, either form, and the batch an initializer
 * `(exec) => state` declared (none for a plain object).
 */
export function resolveInitialState<
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
>(
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>,
  effectsMap: EffectsMap<TState, TEvent, TEffect> | undefined
): { state: TState; queue: Batch<TState, TEvent>[] } {
  if (!isInitializer(initialState)) return { state: initialState, queue: [] };
  const { exec, queued } = createExec(effectsMap);
  const state = initialState(exec);
  return {
    state,
    queue: queued.length ? [{ state, entities: queued }] : [],
  };
}

const isInitializer = <
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
>(
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>
): initialState is InitialEffectStateGetter<TState, TEvent, TEffect> =>
  typeof initialState === "function";

/**
 * Stops `toStop`, then starts every effect in `queue` not started yet,
 * batch by batch, each with its batch's state. `started` keeps what runs,
 * for `suspendRunning`.
 */
export function runEffects<TState, TEvent extends EventObject>(
  toStop: readonly Entity<TState, TEvent>[],
  queue: readonly Batch<TState, TEvent>[],
  started: Set<Entity<TState, TEvent>>,
  dispatch: React.Dispatch<TEvent>
): void {
  for (const entity of toStop) {
    entity.stop();
    started.delete(entity);
  }
  for (const batch of queue) {
    for (const entity of batch.entities) {
      if (entity.status !== IDLE) continue;
      started.add(entity);
      entity.start(batch.state, dispatch);
    }
  }
}

/** Unmount: stops every running effect and returns them, to restart. */
export function suspendRunning<TState, TEvent extends EventObject>(
  started: ReadonlySet<Entity<TState, TEvent>>
): Entity<TState, TEvent>[] {
  const suspended: Entity<TState, TEvent>[] = [];
  for (const entity of started) {
    if (entity.status !== STARTED) continue;
    entity.stop();
    suspended.push(entity);
  }
  return suspended;
}

/** Remount: starts again what the last unmount stopped. */
export function restartSuspended<TState, TEvent extends EventObject>(
  suspended: readonly Entity<TState, TEvent>[]
): void {
  for (const entity of suspended) entity.restart();
}
