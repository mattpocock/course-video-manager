# Frontend state

Every decision the UI makes lives in a **pure reducer**. A component renders
state and turns DOM events into reducer events. A thin effect runner does the
I/O the reducer asks for, and reports the outcome back as another event. Tests
drive the reducer with a sequence of events and assert on the state and effects
it returns. They do not render a component.

This is how we keep tests from sprawling. A rule that lives in a reducer takes
one fast test with no DOM, no mocks and no timers. The same rule left in a
`useState` + `useEffect` tangle can only be reached by rendering the component,
faking its children and waiting for effects, and every component that copies the
tangle needs those tests all over again.

`scripts/check-frontend-state.ts` enforces this (see [The guard](#the-guard)).
[`plans/reducer-migration.md`](./plans/reducer-migration.md) lists the files
that came before the guard and the order they migrate in.

## The pattern

```
 DOM event / SSE message / timer / fetch result
        │  dispatch(event)            ← a fact: what happened
        ▼
 reducer(state, event, exec) ──► next state ──► render
        │  exec({ type: "save-thumbnail", … })   ← a command, as data
        ▼
 effect runner (handler map in a hook) ── does the I/O ──► dispatch(outcome event)
```

This is the Elm architecture (`update : Msg -> Model -> (Model, Cmd Msg)`),
built on [`use-effect-reducer`](https://github.com/davidkpiano/useEffectReducer).
Import the hook from `@/hooks/use-effect-reducer`, the repo's own copy with the
package's API and types; importing `useEffectReducer` from the package is a
lint error, though its types are fine. Inside the reducer, `exec(effect)` does
not run anything. It adds the effect object to a list, and the hook runs that
list after the commit. The reducer stays pure: the same state and event give
the same next state and the same effects, even when StrictMode runs it twice.

The initial state may be an object or a function, `(exec) => state`, which can
declare effects as the surface mounts. Both forms are safe under StrictMode.
Fixed 2026-10-27 (#2389, #2386): the package's hook, given a function, lost
the effect of an event dispatched on mount whenever StrictMode's replay of
that event declared nothing (a reducer that loads once per mount), and never
restarted the initializer's own effects after StrictMode's remount. The repo's
copy fixes both, and `hooks/use-effect-reducer.browser.test.tsx` covers them.

The rules:

1. **One reducer per surface**, in its own `*-reducer.ts` file with no React
   import. The file has a `namespace fooReducer { State; Action; Effect }` and a
   `createInitialFooState()`. Existing examples:
   `features/thumbnail-editor/thumbnail-state-reducer.ts`,
   `features/video-editor/video-state-reducer.ts` and `clip-state-reducer.ts`,
   `features/course-view/course-view-reducer.ts` and
   `features/diagrams/diagram-playground-reducer.ts`.
2. **Events are facts, not commands.** An event says what happened outside the
   reducer. It never says what state to set. Something the world reports is
   past tense: `photo-captured`, `save-succeeded`,
   `background-removal-failed`. Something the user does is named after the
   gesture: `press-delete`, `click-clip`, `new-thumbnail-clicked`. Names are
   kebab-case. A setter event such as `set-saving`, `set-modal-open` or
   `UPDATE_PROGRESS` is not allowed, because the caller has already decided
   what changes and only the reducer should decide that. "Facts" is also the
   only rule that works for both sources: a fetch result cannot be a user
   intent, and a gesture is already a fact.
3. **Effects are commands, and they are data.** Name them with an imperative
   verb (`remove-background`, `archive-clips`) and put everything the handler
   needs into the effect object. A handler should not reach into props or
   closures for its input. That is also what makes the effect worth asserting
   on in a test.
4. **The effect runner is thin.** It is the `useEffectReducer` handler map,
   kept in a `use-foo-reducer.ts` hook (`hooks/use-thumbnail-reducer.ts`). Each
   handler makes one call (fetch, submit, an SSE client, a prop callback) and
   dispatches the outcome as an event. It contains no `if` about what to do
   next: that decision belongs to the reducer, which handles the outcome event.
   A handler may return a cleanup function. `exec.stop` and `exec.replace`
   cancel effects that run for a long time.
5. **The reducer never reads the clock, randomness or the DOM.** Put the value
   on the event instead. The jobs bridge stamps every Job Event with
   `receivedAt: Date.now()` (`features/jobs/use-jobs.ts`, `toJobsAction`), so
   the jobs reducer and the ETA are deterministic.
6. **Derived values are selectors**, pure functions of state such as
   `features/jobs/jobs-selectors.ts` and
   `video-editor-selectors-*.ts`. Do not copy them into state, and do not
   compute them inside a component.
7. **A `useEffect` in a component only bridges to the outside world.** It
   subscribes to something and dispatches what it hears (`teleprompter.tsx`,
   `useBrowserLinkCapture` on the edit page). It does not set local state and
   it does not decide anything.

Three situations come up often enough to have a fixed answer
(`features/diagrams/diagram-playground-reducer.ts` has all three):

- **One I/O must finish before the next starts.** The runner starts every
  effect from one commit at once and does not wait for any of them. If step 2
  depends on step 1, either chain them with an outcome event or declare one
  effect and put the order on it as data (`load-head` with
  `saveOpenHeadFirst`).
- **A late outcome.** An outcome event names what it was for (`diagramId`),
  and the reducer ignores one for something the surface has since left.
- **A caller that awaits.** If a caller needs a promise back, the hook gives
  the event a `requestId`, the reducer copies it onto the effect it declares,
  and the runner resolves that request when the effect is done. The reducer
  still makes the decision.

`useEffectReducer` re-renders on every dispatch, even when the reducer returns
the same state. A bridge that listens to a noisy source, such as a tldraw
session listener that fires on every pointer move, dispatches only when the
value it reports has changed.

A reducer that never needs effects can use plain `useReducer` (the
teleprompter's `teleprompterSession.reducer`). New code that needs effects
declares them with `exec`.

**A toast is a reducer decision, carried on its effect.** The reducer works
out everything the toast needs and puts it on the effect; the handler only
draws it and never reads state. The jobs reducer builds a settled Job's toast
(`features/jobs/job-succeeded-toast.ts`) and declares
`show-job-succeeded-toast` with it, and the handler is
`(_state, effect) => showJobSucceededToast(effect)` (`use-jobs.ts`). Whether to
toast at all is a decision too: a Job Event replayed from before this tab's
snapshot updates the row but never toasts.

## Worked example: the thumbnail editor

The user captures a photo, and the background has to be removed before the
thumbnail can be saved automatically.

The reducer (`features/thumbnail-editor/thumbnail-state-reducer.ts`) receives
the fact, updates state and asks for the I/O:

```ts
case "photo-captured":
  exec({ type: "remove-background", dataUrl: action.dataUrl });
  return {
    ...state,
    capturedPhoto: action.dataUrl,
    cutoutImage: null,
    backgroundRemovalError: null,
    removingBackground: true,
  };
case "background-removal-succeeded":
  return { ...state, cutoutImage: action.dataUrl, removingBackground: false, pendingAutoSave: true };
```

The effect runner (`hooks/use-thumbnail-reducer.ts`) does the I/O and reports
the result back:

```ts
"remove-background": (_state, effect, dispatch) => {
  fetch("/api/remove-background", { method: "POST", body: JSON.stringify({ imageDataUrl: effect.dataUrl }), … })
    .then(async (response) => {
      if (!response.ok) throw new Error("Background removal failed");
      dispatch({ type: "background-removal-succeeded", dataUrl: (await response.json()).imageDataUrl });
    })
    .catch(() => dispatch({ type: "background-removal-failed", error: "Background removal failed. You can retry …" }));
},
```

The component only renders `state` and calls
`dispatch({ type: "photo-captured", dataUrl })` from the camera modal.
Retrying, the spinner, the auto-save and the error text are all reducer
decisions, and the tests cover them without a camera, a fetch or a DOM.

## Testing a reducer

Use `ReducerTester` (`app/test-utils/reducer-tester.ts`). Send a sequence of
events that a user or the server could actually produce. Then assert on the
state that results and on the full list of declared effects:

```ts
// features/thumbnail-editor/thumbnail-state-reducer-capture.test.ts
it("a failed background removal can be retried", () => {
  const tester = new ReducerTester(
    thumbnailStateReducer,
    createInitialThumbnailState()
  );

  const state = tester
    .send({ type: "photo-captured", dataUrl: "photo" })
    .send({ type: "background-removal-failed", error: "timeout" })
    .send({ type: "retry-background-removal" })
    .getState();

  expect(state.removingBackground).toBe(true);
  expect(tester.getEffects()).toEqual([
    { type: "remove-background", dataUrl: "photo" },
    { type: "remove-background", dataUrl: "photo" },
  ]);
});
```

- Use `toEqual` on `getEffects()` for the whole list, so an extra effect fails
  the test as well. The effects are the reducer's **output**, so this is not
  the "call counts on internal collaborators" red flag described in
  [`TESTING_STANDARDS.md`](./TESTING_STANDARDS.md). Assert on the effect data,
  never on the `exec` mock.
- A test drives a scenario such as "a failed save can be retried". It does not
  check one `case` at a time.
- A reducer test takes the place of the component test. Once logic moves into a
  reducer, **delete** any component or hook test that checked the same rule
  through rendering. The only component tests left are the rare ones about
  rendering itself (see `TESTING_STANDARDS.md`).
- Effect handlers are glue (rule 4) and normally have no test of their own. If
  one is complicated enough to need a test, pull the complicated part out into a
  pure function or a boundary client (`sse-*-client.ts`) and test that.

## When plain `useState` is fine

A component may keep `useState` when **all** of these are true:

- The state belongs to this component's own presentation: a popover or
  dropdown that is open, a hover, a text draft that is submitted as one event.
- No other state is updated in step with it, and no rule decides how it
  changes beyond "set it to what the user just typed or clicked".
- No effect writes to it.

Several `isFooModalOpen` booleans together fail the first rule, because only one
modal can be open at a time. That makes them one piece of state:
`openModal: "rename" | "copy" | null`, kept in the surface's reducer. Even
the course view's reducer has not done this yet: it still holds nine
`is…ModalOpen` booleans, and they should not be copied.

## The guard

`scripts/check-frontend-state.ts` runs in pre-commit and in `pnpm run check`.
It scans `apps/local/app`, skipping test code, and fails a file when:

| Guard               | Fails when a file has…                                                               | Why                                                                  |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `use-state`         | more than **4** `useState` calls                                                     | past a few independent toggles, they are one state machine in pieces |
| `effect-sets-state` | more than **1** `useEffect`/`useLayoutEffect` that references the file's own setters | each such effect is a state transition happening outside any reducer |

The limits were set against the codebase as it was when the guard landed
(762 files scanned). Of the 124 files that call `useState`, 107 have four or
fewer, and the 13 with exactly four are mostly modal forms. One effect that
writes state is common (36 files) and usually acceptable, such as resetting a
form when its dialog opens. Two or more (12 files) is where the tangles are.

The 24 files that were already over a limit when the guard landed are listed in
`scripts/frontend-state-allowlist.json`. An entry's count can only go down.
Delete the entry once the file is back under the limit. Do not add entries;
migrate the file instead (`plans/reducer-migration.md`).
