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
 reducer(state, event, exec) ──► next state ──► store ──► useSelector(slice) ──► render
        │  exec({ type: "save-thumbnail", … })   ← a command, as data
        ▼
 effect runner (handler map in a hook) ── does the I/O ──► dispatch(outcome event)
```

This is the Elm architecture (`update : Msg -> Model -> (Model, Cmd Msg)`),
with [`use-effect-reducer`](https://github.com/davidkpiano/useEffectReducer)'s
reducer and effect API, held in an **effect store**
(`hooks/effect-store.ts`) that components read by slices (see
[Reading a surface](#reading-a-surface-the-effect-store-and-useselector)).
Inside the reducer, `exec(effect)` does not run anything. It adds the effect
object to a list, and the runner starts that list once the event's state is
published. The reducer stays pure: the same state and event give the same
next state and the same effects, even when StrictMode runs it twice.

Surfaces that came before the store still call `useEffectReducer` from
`@/hooks/use-effect-reducer`, the repo's own copy with the package's API and
types. Importing `useEffectReducer` from the package is a lint error, though
its types are fine.

Both runners share `hooks/effect-entity.ts`:

- the `exec` a reducer step is given, with `exec.stop` and `exec.replace`;
- resolving the initial state;
- the stop-then-start pass over a queue of batches;
- the suspend on unmount and the restart on remount.

So an effect behaves the same in each runner, and the runners differ only in
when that code runs. #2715 lists the surfaces still to move. New code uses the
store.

The initial state may be an object or a function, `(exec) => state`, which can
declare effects as the surface mounts. Both forms are safe under StrictMode.
Fixed 2026-10-27 (#2389, #2386): the package's hook, given a function, lost
the effect of an event dispatched on mount whenever StrictMode's replay of
that event declared nothing (a reducer that loads once per mount), and never
restarted the initializer's own effects after StrictMode's remount. The repo's
copy fixes both, and `hooks/use-effect-reducer.browser.test.tsx` covers them.
The store keeps both fixes (`hooks/effect-store.browser.test.tsx`).

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
4. **The effect runner is thin.** It is the handler map given to
   `useEffectStore` (or `useEffectReducer`), kept in a `use-foo.ts` hook
   (`features/video-editor/use-cvm-recorder.ts`). Each
   handler makes one call (fetch, submit, an SSE client, a prop callback) and
   dispatches the outcome as an event. It contains no `if` about what to do
   next: that decision belongs to the reducer, which handles the outcome event.
   A handler may return a cleanup function. `exec.stop` and `exec.replace`
   cancel effects that run for a long time. Only an effect with a cleanup
   counts as running: one without is done once its handler returns. An
   effect handler that forwards a callback uses a block body, so the
   callback's return value can never become a cleanup by accident.
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

The store notifies nobody when the reducer returns the same state, so an
ignored event renders nothing. `useEffectReducer` re-renders on every dispatch,
even then. On a surface not yet moved, a bridge that listens to a noisy source,
such as a tldraw session listener that fires on every pointer move, dispatches
only when the value it reports has changed.

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

## Reading a surface: the effect store and `useSelector`

A surface's state lives in an **effect store**, outside React, and each
component subscribes to the slice it shows. A component that takes the whole
state re-renders on every event the surface hears. For the CVM recorder,
which hears a `recorder-status` every second or so, that meant re-rendering
the whole editor (#2714).

```ts
// The hook that owns the surface: the same reducer, initial state and handlers.
const store = useEffectStore(cvmRecorderReducer, () => createInitialCvmRecorderState(format), {
  "stop-recording": (_state, _effect, dispatch) => { … },
});

// A component reads a slice. It re-renders only when `stillRound` changes.
const round = useSelector(store, stillRound);
```

- **`useEffectStore(reducer, initialState, handlers)`** takes
  `useEffectReducer`'s arguments and creates the store once for the
  component's life. It returns `{ getSnapshot, subscribe, dispatch }`.
  `dispatch` never changes, so callbacks built on it can sit in a context
  without changing it. The handlers are the latest render's, so they may close
  over props; the reducer and initial state are read once.
- **`useSelector(store, selector, isEqual = Object.is)`**, built on
  `useSyncExternalStore`, returns `selector(state)`. It re-renders only when
  that changes by `isEqual`. Pass a selector from the reducer's file
  (`stillRound`, `canStop`), a field (`(s) => s.alert`), or an inline one that
  closes over a prop (`(s) => holdsStillsOf(s, clip)`). A selector that builds
  an object or array needs an `isEqual` that compares its contents
  (`sameLivePreview` in `live-preview.ts`), or it re-renders on every change.
  So does a list the reducer rebuilds without changing an entry: the editor
  reads the clip reducer's `items` with `sameElements`
  (`hooks/effect-store.ts`).
- **Never select the whole state.** `(s) => s`, `(s) => ({ ...s })` and
  `useSyncExternalStore(…, store.getSnapshot)` fail the `whole-store` guard.
  If a hook seems to need all of it, pass it the slices it reads instead
  (`useLastFrameUrl` takes `{ source, round }`).
- **The latest props reach handlers through one ref.** A surface hook whose
  handlers or callbacks call the editor's latest callbacks keeps them in a ref
  updated in `useLayoutEffect`, never assigned during render.
  `use-cvm-recorder.ts`'s `editor` ref serves both its effect handlers and its
  controls.
- **A handler reads the state now from the store.** A handler that reads the
  state later than its event, or reads more than its event's state, calls
  `store.getSnapshot()`, never a copy a render made: the store starts it
  before React renders. The clip reducer's handlers get `getClipState`
  (`use-video-editor-wiring.ts`).
- **Read it on press with `store.getSnapshot()`.** An event handler that needs
  the state at the moment of a click reads it then, and subscribes to nothing
  (`useNewShortAction`, and the wiring's "Create video from selection").
- **A surface hook hides the store.** The editor's components call
  `useCvmRecorderSelector(selector)`, which finds the store in
  `VideoEditorContext` (`use-cvm-recorder-selector.ts`). The context holds the
  store and callbacks, and that object stays the same while the recorder
  changes. The clip reducer's is `useClipStateSelector`
  (`MissingWordTimingBadge`).
- **The hook that owns a store subscribes to almost nothing.** It hands the
  store down and keeps for itself only the slices it uses. The editor's
  wiring reads one field of the clip state (the mic offset refusal it gives
  the recorder), so a clip event renders `VideoEditor`, not the route.

**When effects run.** `useEffectReducer` starts a batch of effects after React
commits, which costs a commit of its own. The store starts them right after
the event's state is published, with no render. Everything else is the same:

- Effects run in the order they were declared, one event's batch at a time.
- Each is handed the state its event produced, and an event's stops run
  before its starts.
- `exec.stop` and `exec.replace` cancel, and a cleanup runs when its effect
  stops.
- Unmount stops what is running, and StrictMode's remount starts it again.
  Running means its handler returned a cleanup (a timer, a subscription). A
  handler that returns none (a fetch that dispatches its outcome, a prop
  callback) is done once it has run: the remount does not run it again, and
  stopping it does nothing (#2718).

So a handler that looks up the DOM its event changes waits a frame: the
element may not be rendered yet. The clip reducer's `scroll-to-insertion-point`
scrolls in a `requestAnimationFrame`, and cancels it in its cleanup.

`cvm-recorder-render-benchmark.browser.test.tsx` asserts the render and commit
counts a whole Recording Session's events cost the editor, per component and
per event, so a consumer that goes back to the whole state fails it.
`clip-reducer-render-benchmark.browser.test.tsx` does the same for the clip
reducer, through the real `useVideoEditorWiring` and `VideoEditor`.

Events run to completion: an event that a handler dispatches synchronously
waits until every effect before it has started. It never runs inside another
event's reducer. `hooks/effect-store.test.ts` and
`hooks/effect-store.browser.test.tsx` pin all of this down.

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
| `whole-store`       | any read of a store's whole state (below)                                            | it re-renders on every event; select the slice the component shows   |

`whole-store` is a hard 0: it takes no allowlist entries, and an entry for it
fails. It catches:

- **A store selector that returns its parameter.** Examples are `(s) => s`,
  `(s) => ({ ...s })`, `(s) => Object.assign({}, s)` and a block that returns
  it. It also sees through `as`, `satisfies` and `!`, and checks a function
  declared in the same file that is passed by name.
- **The selector by position**: `useSelector(store, selector, isEqual)` or
  `useFooSelector(selector, isEqual)`. An `isEqual` is never judged, and
  `useContextSelector` is out of scope.
- **`useSyncExternalStore(subscribe, store.getSnapshot)`**, or a function
  returning `store.getSnapshot()`, anywhere but `hooks/effect-store.ts`. A
  `useSyncExternalStore` that reads its own narrow value passes, such as the
  Live Timer's clock tick (`live-timer.tsx`) or a still's place in the queue
  (`queued-still.tsx`).

The first two limits were set against the codebase as it was when the guard landed
(762 files scanned). Of the 124 files that call `useState`, 107 have four or
fewer, and the 13 with exactly four are mostly modal forms. One effect that
writes state is common (36 files) and usually acceptable, such as resetting a
form when its dialog opens. Two or more (12 files) is where the tangles are.

The 24 files that were already over a limit when the guard landed are listed in
`scripts/frontend-state-allowlist.json`. An entry's count can only go down.
Delete the entry once the file is back under the limit. Do not add entries;
migrate the file instead (`plans/reducer-migration.md`).
