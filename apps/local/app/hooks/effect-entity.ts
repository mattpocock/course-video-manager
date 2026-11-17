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
 *
 * An effect whose handler returns a cleanup runs until it is stopped (a
 * timer, a subscription): an unmount suspends it and the remount restarts
 * it. One that returns none (a fetch that dispatches its outcome, a prop
 * callback) is done once it has run (#2718): its status goes straight to
 * stopped, a remount does not run it again, and stopping it does nothing.
 * So `status` is started exactly while an effect holds a cleanup.
 */

/** One declared effect. */
export type Entity<TState, TEvent extends EventObject> = EffectEntity<
  TState,
  TEvent
> & {
  /** Unmount: runs the cleanup, but keeps what it started with. */
  suspend: () => void;
  /** Remount: starts a suspended effect again, as it first started. */
  restart: () => void;
};

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
      cleanup = effect.exec?.(state, effect, dispatch);
      // Running only while it holds a cleanup. A one-shot effect is done,
      // and keeps no state to restart with.
      const running = typeof cleanup === "function";
      entity.status = running ? STARTED : STOPPED;
      startedWith = running ? [state, dispatch] : undefined;
    },
    stop: () => {
      entity.suspend();
      startedWith = undefined;
    },
    suspend: () => {
      if (typeof cleanup === "function") cleanup();
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
 * The effects a runner has running (those holding a cleanup), and the ones
 * its last unmount suspended. Each runner owns one for its surface's life.
 */
export type RunningEffects<TState, TEvent extends EventObject> = {
  /**
   * Stops `toStop`, then starts every effect in `queue` not started yet,
   * batch by batch, each with its batch's state.
   */
  run: (
    toStop: readonly Entity<TState, TEvent>[],
    queue: readonly Batch<TState, TEvent>[],
    dispatch: React.Dispatch<TEvent>
  ) => void;
  /** Unmount: suspends every running effect, to restart on the remount. */
  suspendAll: () => void;
  /** Remount: starts again what the last unmount suspended, unless stopped since. */
  restartSuspended: () => void;
};

export function createRunningEffects<
  TState,
  TEvent extends EventObject,
>(): RunningEffects<TState, TEvent> {
  const running = new Set<Entity<TState, TEvent>>();
  let suspended: Entity<TState, TEvent>[] = [];
  const keepIfRunning = (entity: Entity<TState, TEvent>) => {
    if (entity.status === STARTED) running.add(entity);
  };
  return {
    run: (toStop, queue, dispatch) => {
      for (const entity of toStop) {
        entity.stop();
        running.delete(entity);
      }
      for (const batch of queue) {
        for (const entity of batch.entities) {
          if (entity.status !== IDLE) continue;
          entity.start(batch.state, dispatch);
          keepIfRunning(entity);
        }
      }
    },
    suspendAll: () => {
      for (const entity of running) {
        entity.suspend();
        suspended.push(entity);
      }
      running.clear();
    },
    restartSuspended: () => {
      const restarting = suspended;
      suspended = [];
      for (const entity of restarting) {
        entity.restart();
        keepIfRunning(entity);
      }
    },
  };
}
