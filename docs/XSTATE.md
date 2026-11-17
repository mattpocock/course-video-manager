# The strict XState profile (PoC)

A proof of concept (the CVM recorder, `features/video-editor/cvm-recorder-machine.ts`): XState with ONE way to do each thing, so neither you nor an agent ever picks between equivalent APIs. Every surface still on `useEffectReducer` follows [FRONTEND_STATE.md](./FRONTEND_STATE.md); the same ideas carry over (events are facts, effects are named commands with their data, derived values are selectors).

**Version:** `xstate@6.0.0-beta.3` and `@xstate/react@7.0.0-beta.0`, pinned exact. v6 over v5 because tsc checks a transition's `target` against the states, and per-state context contracts (typestates) narrow `context`. v5 accepts a misspelled target and has no typestates.

## One way to do each thing

| Part                        | The way                                                                                                                                    | Not                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Machine                     | `setup({ schemas, actions, states }).createMachine({ id, context, initial, on, states })` in a `*-machine.ts` file with no React           | `createMachine` alone, `createStateConfig`, `createSystem`, JSON, `xstate/fsm`                  |
| Types                       | `schemas` of `types<T>()`: `input`, `context`, `events`, `internalEvents`; a state's `schemas.context` narrows its context                 | `emitted`, `output`, `children`, Zod at runtime                                                 |
| States                      | flat: each state is `{ on, after, description }`                                                                                           | child states (#5921), `entry`/`exit`, `invoke`, `always`, `type`, `history`                     |
| Transition                  | a function `({ context, event, actions }, enq) => ({ target: "sibling", context: patch })`, or `undefined` to ignore the event             | object, string or array forms, `matches`/`to`                                                   |
| Guard                       | an `if` in the transition function that returns `undefined`                                                                                | `guard`, named guards, choice and route states                                                  |
| Effect                      | `enq(actions.name, params)`: a named action declared in `setup`, with its data                                                             | an inline `enq(() => …)`, `enq.emit`/`sendTo`/`spawn`/`log`/`cancel`, invoked or spawned actors |
| Next step in the same event | `enq.raise(internalEvent)`                                                                                                                 | `enq.raise` with `delay`                                                                        |
| Time                        | `after: { [ms]: () => ({ target }) }` on a state                                                                                           | `enq.raise` with a delay, timers in effects                                                     |
| Outcome of an effect        | the editor's implementation sends it back as a declared event (`stop-recording-failed`)                                                    | `invoke` with `onDone`/`onError`                                                                |
| React                       | `useActorRef(machine.provide({ actions }))` in one `use-*.ts` hook; components read slices with `useSelector(actor, selector)`             | `useMachine`, `useActor`, `createActorContext`, a `useSelector` compare                         |
| Tests                       | `transition()`/`initialTransition()` through `MachineTester` (`test-utils/machine-tester.ts`): state as selectors read it, effects as data | `createActor`, `waitFor`, `SimulatedClock`                                                      |

Name each named action by an arrow on its own key: XState reports an enqueued action under its function's name, so an anonymous one shows up as `""` in `transition()`'s effects.

## The #5921 workaround

beta.3 does not check a state's context contract when the transition enters it through its parent (`target: "parent.child"`, `#id`, or a compound state whose initial child has a contract), nor between siblings inside a state with one (statelyai/xstate#5921). The machine is flat, so every target is a sibling and every contract is checked. **Remove the `flat-states` rule once #5921 is fixed in the pinned beta.**

## Enforced by

- `no-restricted-imports` in `.oxlintrc.json`: the APIs outside the profile (`pnpm run lint`).
- `scripts/check-xstate-profile.ts`: `machine-file`, `setup-shape`, `state-shape`, `flat-states`, `transition-function`, `literal-target`, `named-effects`, `binding`. It runs on staged files in pre-commit and on every file in `check:static`, which CI runs. Its tests are `tests/xstate-profile-guard.test.ts`.
