import { vi } from "vitest";
import type {
  EffectObject,
  EffectReducer,
  EffectReducerExec,
  EventObject,
} from "use-effect-reducer";

export const createMockExec = () => {
  const fn = vi.fn() as any;
  fn.stop = vi.fn();
  // Like the real `exec.replace`: it declares the new effect, so
  // `getEffects()` lists it, and returns that effect's entity.
  fn.replace = vi.fn((_entity: unknown, effect: unknown) => fn(effect));
  return fn;
};

export class ReducerTester<
  TState,
  TAction extends EventObject,
  TEffect extends EffectObject<TState, TAction>,
> {
  private reducer: EffectReducer<TState, TAction, TEffect>;
  private state: TState;
  private exec: EffectReducerExec<TState, TAction, TEffect>;

  constructor(
    reducer: EffectReducer<TState, TAction, TEffect>,
    initialState: TState
  ) {
    this.reducer = reducer;
    this.state = initialState;
    this.exec = createMockExec();
  }

  public send(action: TAction) {
    this.state = this.reducer(this.state, action, this.exec);
    return this;
  }

  public getState() {
    return this.state;
  }

  public getExec() {
    return this.exec;
  }

  /**
   * Every effect the reducer declared since construction (or the last
   * `resetExec`), in order. Assert on this list whole, so an extra effect
   * fails the test too. See docs/FRONTEND_STATE.md.
   */
  public getEffects(): TEffect[] {
    return (
      this.exec as unknown as { mock: { calls: [TEffect][] } }
    ).mock.calls.map(([effect]) => effect);
  }

  public resetExec() {
    this.exec = createMockExec();
    return this;
  }
}
