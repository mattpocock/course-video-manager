import {
  initialTransition,
  transition,
  type AnyStateMachine,
  type EventFromLogic,
  type ExecutableEffect,
  type InputFrom,
  type SnapshotFrom,
} from "xstate";

/**
 * The machine counterpart of `ReducerTester`: drives an XState machine with
 * the pure `transition()`, so no actor starts and no effect runs. Every named
 * action the machine enqueues is kept as data, `{ type: name, ...params }`.
 * Assert on `getEffects()` whole, so an extra effect fails the test too.
 */
export class MachineTester<
  TMachine extends AnyStateMachine,
  TState,
  TEffect extends { type: string },
> {
  private snapshot: SnapshotFrom<TMachine>;
  private effects: TEffect[] = [];

  constructor(
    private readonly machine: TMachine,
    input: InputFrom<TMachine>,
    private readonly project: (snapshot: SnapshotFrom<TMachine>) => TState
  ) {
    const [snapshot, effects] = initialTransition(machine, input);
    this.snapshot = snapshot;
    this.keep(effects);
  }

  public send(event: EventFromLogic<TMachine>) {
    const [snapshot, effects] = transition(this.machine, this.snapshot, event);
    this.snapshot = snapshot;
    this.keep(effects);
    return this;
  }

  public getState(): TState {
    return this.project(this.snapshot);
  }

  public getSnapshot(): SnapshotFrom<TMachine> {
    return this.snapshot;
  }

  public getEffects(): TEffect[] {
    return this.effects;
  }

  public resetExec() {
    this.effects = [];
    return this;
  }

  private keep(effects: readonly ExecutableEffect[]) {
    for (const effect of effects) {
      if (effect.kind !== "action") continue;
      const [params] = argsOf(effect.params);
      // The machine's own types checked these params when it enqueued them.
      this.effects.push(
        Object.assign({ type: effect.type }, params) as TEffect
      );
    }
  }
}

/** A named action's params, as `transition()` reports them. */
const argsOf = (params: unknown): unknown[] =>
  typeof params === "object" &&
  params !== null &&
  "args" in params &&
  Array.isArray(params.args)
    ? params.args
    : [];
