import type {
  EffectEntity,
  EffectFunction,
  EffectObject,
  EffectsMap,
  EventObject,
  InitialEffectStateGetter,
} from "use-effect-reducer";

/**
 * One declared effect, as both runners hold it: `useEffectReducer`
 * (`use-effect-reducer.ts`) and the effect store (`effect-store.ts`). Shared
 * so the two cannot drift on how an effect starts, stops, cleans up and
 * restarts after StrictMode's remount.
 */
export type Entity<TState, TEvent extends EventObject> = EffectEntity<
  TState,
  TEvent
> & { restart: () => void };

export type Status = EffectEntity<unknown, EventObject>["status"];
export const IDLE = 0 as Status;
export const STARTED = 1 as Status;
const STOPPED = 2 as Status;

/** The effects one event declared, with the state that event produced. */
export type Batch<TState, TEvent extends EventObject> = {
  state: TState;
  entities: Entity<TState, TEvent>[];
};

export const isInitializer = <
  TState,
  TEvent extends EventObject,
  TEffect extends EffectObject<TState, TEvent>,
>(
  initialState: TState | InitialEffectStateGetter<TState, TEvent, TEffect>
): initialState is InitialEffectStateGetter<TState, TEvent, TEffect> =>
  typeof initialState === "function";

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
export const toEntity = <
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
