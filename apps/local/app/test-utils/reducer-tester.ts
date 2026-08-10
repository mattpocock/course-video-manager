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
  fn.replace = vi.fn();
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

  public resetExec() {
    this.exec = createMockExec();
    return this;
  }
}
