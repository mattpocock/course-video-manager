# Coding standards

The rules a human or an agent holds in their head while writing and reviewing
code here. Each rule's essence is here; the longer reasoning lives in the doc it
links.

## Effect and configuration

Wherever possible, use Effect primitives like `FileSystem` over promises, for
DI and type-safe errors. Effect should not leak into the user-facing API.

Read every environment variable a run needs at its start, not at the moment of
use. A `Config.string(...)` in a rarely-run branch turns a missing `.env` line
into a failure that appears only when that branch first runs, after the work
before it. Resolve config at the edge (the layer, or the command's entry point)
so a missing variable stops the process before any work starts, and let the
error name the variable.

The three rules below are enforced by `@effect/tsgo`, type-aware oxlint and
`scripts/check-effect-guards.ts`. Detail, rule names and the allowlist:
[`docs/EFFECT_STANDARDS.md`](./docs/EFFECT_STANDARDS.md).

### Effects are run, never dropped

An Effect is a description of work; one that is neither yielded nor returned is
silently skipped.

- **Yield or return every Effect** — `yield* eff`, never a bare `eff;` or
  `yield eff`.
- **`return yield* eff`, never `return eff`** inside `Effect.gen`.
- **Never `Effect.run*` inside an Effect** — it starts a detached runtime.
- **Never `await` an Effect** — it is not a promise.

### Failures are handled in Effect, not around it

Inside `Effect.gen`, a failure is a value in `E`, not a thrown exception.

- **`return yield*` a failure** (`return yield* new FooError(...)`).
- **No `try/catch` inside a generator** — use `Effect.try` / `Effect.tryPromise`.
- **No `*Sync` Schema decode inside an Effect** — use `Schema.decodeUnknown`.
- **Never `catch*` an Effect that cannot fail**; say `catchAllDefect` if you
  mean defects.
- **Every error in `E` is tagged** (`Data.TaggedError` / `Schema.TaggedError`,
  never global `Error`), keeping the underlying error as `cause` — tests too.

### Effects stay inside their boundary

- **Run an Effect only at a boundary**: `makeLoader` / `makeAction`, the CLI, a
  daemon's entry point, `createSseResponse`, `withDbTransaction`. Anywhere else,
  return an Effect instead.
- **Never swallow a failure silently.** Catch the tag you expect, or log what
  you drop; clean up temp files with `removeBestEffort`.
- **`Effect.tryPromise`, not `Effect.promise`, for anything that can reject**
  (a Drizzle call fails with `UnknownDBServiceError`).

## Control flow

### A switch over a union names every member

A `switch` on a union type lists every member as its own `case`, even the ones
that share a branch. A `default` that quietly absorbs the leftover members also
absorbs the member someone adds next month, and that new member takes the
fallback branch without anyone deciding it should — a new clip-service write
event would skip the Draft guard. Without a `default`, adding a member breaks
the lint until each switch says what to do with it.

Enforced by type-aware oxlint (`typescript/switch-exhaustiveness-check`, an
error in `.oxlintrc.json`).

## Errors

### Throw Errors, not values

Outside Effect, throw an `Error` or a subclass of one. A thrown string or plain
object has no stack and fails every `instanceof Error` check downstream, so the
handler that logs or maps it loses track of where it came from. Inside Effect,
fail with a tagged error instead (`Effect.fail(new XError(...))`), never with
`throw`. The one exception is React Router's `throw data(..., { status })` in
a loader or action, because that is how a route answers with an error status.

Enforced by type-aware oxlint (`typescript/only-throw-error`, an error in
`.oxlintrc.json` that allows `data()`).

### Every promise is awaited, handled or marked void

A promise nobody awaits loses its rejection: the failure turns into an
unhandled rejection rather than an error the caller sees, and the work it
started may still be running after the caller has moved on. Await it, or
`.catch` it where it is made. When fire-and-forget really is the intent (a
signal handler, a best-effort log line), write `void promise` with a comment
saying why nothing waits on it. Do not hand an async function to a slot that
expects a `void` callback either (an event listener, `forEach`), because
nothing there awaits or catches what it returns.

Enforced by type-aware oxlint (`typescript/no-floating-promises` and
`typescript/no-misused-promises`) as a ratchet. They are errors in the
directories listed in `.oxlintrc.json`'s `overrides`, which are services, CLI,
`.ts` routes, `features/jobs`, `apps/remote`, `packages` and scripts, and warnings in the
React UI. A file you touch should leave review with fewer warnings than it had.

## Function signatures

Optional parameters passed to functions should be scrutinised extremely
carefully. They are a huge source of bugs (by omission). Prioritise correctness
over backwards compatibility.

## Types

### Every `any` is a leak

An `any` switches the type checker off for every value that flows through it.
Write the type you mean: a known shape gets a named `interface`; an unknown one
gets `unknown` and is narrowed; one that varies by caller gets a generic
**constrained** to the real thing (`<R extends LayerLive>`, not `<R>`); a
library's symbol or brand gets the library's own exported id
(`Runtime.FiberFailureCauseId`), not a cast.

The cost, from this repo: `makeLoader` took `ManagedRuntime<any, any>` with an
unconstrained `R`, so a route asking for an unprovided service type-checked
across all 111 route modules and the Animatic page 500ed on every load.

An `any` survives review only when a third-party type is genuinely `any` at the
boundary: cast once at the edge into a named type and keep it out of exported
signatures. A new `any` needs a reason in the PR; a file you touch should leave
review with fewer of them than it had.

## Course Versions

### A write to anything a Version owns goes through the Draft guard

Only a Draft CourseVersion accepts writes. Every DB write entry point calls the
matching `requireDraftVersionFor…` in
`packages/core/services/draft-guard.server.ts`, in the SAME transaction as the
write, and fails with `VersionNotDraftError` otherwise. **A NEW NOUN INHERITS
THE GUARD FROM WHAT IT HANGS OFF**: if a row reaches a CourseVersion through a
Video, Clip or Section, add its `requireDraftVersionFor<Noun>` and call it from
every create, update, move and archive. The guard also catches **stranded
writes** onto a superseded Version's rows. "Not part of the published artifact"
is not an exemption; "no row above it reaches a CourseVersion" is. The ~250
stranded writes that taught this: [`docs/DRAFT_GUARD.md`](./docs/DRAFT_GUARD.md).

## Database connections

### Every database client comes from a guarded factory

Build a client through `DrizzleService`, `scriptPgClient()`/`scriptDrizzle()` (one-off scripts) or `test-utils/test-db.ts` (tests) — never `new Pool`/`new Client`/`drizzle(`/`postgres(` or a read of `process.env.DATABASE_URL` yourself, which skips the connection guard that stops a worktree writing to production; `scripts/check-db-clients.sh` fails anything else, and its allowlist does not grow.

## Background work

### Background work runs in the sidecar

Work the author starts and walks away from — an export, a render, a post, a
Publish — is a **Job**: enqueue it with `enqueueJob` (`apps/local/sidecar/job-specs.ts`)
and let the **Sidecar** run it; a handler that starts another Job asks
`ctx.enqueue`, the same path (`sidecar/job-context.test.ts`). The browser starts one through the Upload
Manager's `startJob` (`features/jobs/use-jobs.ts`, `POST /api/jobs`) and
follows it through `jobs-reducer.ts`. Do not stream it from a request that a browser
tab keeps alive: closing the tab cancels the work, and its failure dies as a
toast. A new kind is its params in `sidecar/job-params.ts`, a handler under
`apps/local/sidecar/kinds/`, one line in `JOB_KINDS` and one in
`JOB_KIND_SPECS` (what a route enqueues against, with no handler in reach); its lane and attempt count are copied from the job it replaces
(`retry-policy.ts`), never invented — except a kind that **posts** to an
outside service (YouTube, Buffer, AI Hero): define it with
`definePostingJobKind`, which fixes it at one attempt, never re-queued, and
makes you say how to check whether a cut-off post went out
(`sidecar/posting-kinds.test.ts` fails otherwise). Work that has moved into a Job asks for
`SidecarContext` (`app/services/sidecar-context.ts`), which only the sidecar
provides, so a route that reaches it does not compile.

**Spawning a process is the Sidecar's.** The encodes (`ffmpeg-run.ts`,
`ffmpeg-encode-commands.ts`), the Overlay renderer and the services built on
them live only in the Sidecar's layer (`sidecar/sidecar-layer.ts`), never in
`layerLive`, and `apps/local/.dependency-cruiser.spawn.cjs` fails
`lint:boundaries` if a route can reach one. On the app server a process starts
only from a named interactive entry point — a probe, a frame, "Reveal in
Explorer", "Send feedback": something a person waits on for a moment.
`child_process` is held to those files by the same config, and
`@effect/platform`'s `Command.make` by the `spawn` guard of
`scripts/check-background-jobs.ts`, each with its reason. A new long process
is a Job. `scripts/check-background-jobs.ts` also holds
the streaming routes and the browser loops that drive them to a shrink-only
allowlist. Interactive streams (the Article Writer, a modal the author watches)
stay, by name. The plan and the order the jobs move in:
[`docs/plans/background-jobs-sidecar.md`](./docs/plans/background-jobs-sidecar.md).

### Work that runs during a take stays below the capture

A Clip is transcribed as it arrives, while its take is still recording
(#2224), because the recording workflow needs its text at once. Anything
that runs mid-take must never take time from the capture (#2214, which lost
41 frames to a Whisper cold start and stills grabbed from the growing take):

- It runs at the lowest CPU priority: `nice -n 19` for ffmpeg and the Local
  Whisper worker (`whisper-transcription-service.ts`,
  `sidecar/local-whisper-engine.ts`). The capture, mic and writers are High.
- It reads only what it needs from a file still being written. A growing
  `.mkv` has no Cues, so `ffmpeg -ss` reads it from the start: go through
  `copyMkvSpan` (`app/services/mkv-span.ts`), which copies out only the
  Clusters it needs.
- It never cold-starts the GPU: the recorder keeps Whisper loaded while it
  is open (`recorder-client/whisper-warmth.ts`).
- Heavier work waits for Stop: `transcribe-footage` Jobs
  (`HELD_WHILE_RECORDING_KINDS`) and the stills of the live take
  (`holdsStillsOf`).

### A script, harness or test starts Windows processes only through the Windows guard

Before a script, harness or test starts any Windows-side process
(`ffmpeg.exe`, PowerShell, any `.exe`), it calls `guardWindows()` from
`apps/local/scripts/windows-guard.ts`, and it starts every such process
through what that returns (`windows.spawn(exe, args, { cwd })`,
`windows.powershell(command)`). From a shell, use
`pnpm --filter @cvm/local windows-guard -- <exe> [args…]`, or
`windows-guard --check` (exit 3: refuse). The guard refuses, saying why,
while the recorder service, a recorder `ffmpeg.exe` or OBS is running. It
also starts every Windows process at Idle priority on cores 6–9.
`nice` and `taskset` stop at WSL's edge, so never `spawn` a `.exe` directly
from a harness: one at Normal priority starved the Cam Link capture and
lost a take 212 frames (#2214). Prefer Linux `ffmpeg` with synthetic
sources (`lavfi`), and never open a real device. The recorder service's own
launcher (`recorder-service/windows-launcher.ts`) is the one exception,
because it is the recorder.

## Entities and their actions

### Every entity is right-clickable

Every entity the app renders — a Course, Section, Lesson, Video, Clip, Chapter,
Beat, Pitch, Deliverable — answers a right-click with a context menu. An entity
with actions and no right-click handler is an unfinished entity.

The right-click menu and the entity's **Actions menu** (the `Actions` dropdown,
or the `…` button) offer **the same set of actions** — see "Action menus".

### Every entity menu can copy its link

Every entity's right-click menu and Actions menu ends its copy group with
"Copy Link", which copies the full app URL that opens the entity. There is no
"Copy ID": `cvm` takes a link anywhere it takes an id, because every id argument
is declared through `cli/entity-id.ts`. Build entity URLs only in `entityDeepLink`, and
read them back only with its inverse `parseEntityRef`. A link names its exact entity and
the hierarchy above it: one shown on a parent's page carries its own id in a `?<type>=<id>`
query param, and anything on a Video in a Lesson also carries `course`, `section` and
`lesson` params, which `EntityMenuContent` fills in from the nearest `LessonPlaceProvider`.
A page that shows a Course's Videos provides one. A new entity type
gets its route in both functions and a test case beside them, which checks they stay inverses. Never hand-roll a URL or a clipboard item in a menu: `EntityMenuContent` (below) adds it,
and `scripts/check-entity-links.sh` fails a clipboard write of a hand-built app URL or a raw `.id`.

### Filters stay in sync with the entity

Filters must stay in sync with the shape of the data they filter. When a new
field is added to an entity that affects what something "is" (status, category,
state), every filter, count, and badge that surfaces that concept must be
updated to take the new field into account. Filters are part of the entity's
definition, not a one-time UI feature — drift between them and the data shape
produces silently-wrong results.

## Action menus

An action menu lists verbs that act on one thing; a value picker (Effort,
Priority) is exempt. Distilled from Apple's HIG, NN/g and Fluent.

**Build every action menu with `EntityMenuContent`** (`ActionMenuContent` for
one not about an entity) from `features/action-menu/`. Declare each action
under its kind of group, taking common labels and icons from
`STANDARD_ACTIONS`; the component owns order, separators, destructive styling,
the ellipsis and Copy Link.

1. **One list, two doors.** An entity's right-click menu and its Actions / `…`
   dropdown render the same `groups`, built once beside the entity. A door
   that can't run an action in place still lists it and navigates to the
   entity's page to run it there (`CourseMenuIntent`).
2. **Groups come in one order:** `open` → `edit` → `create` → `move` → `run`
   (export, render, post) → `copy` (clipboard; Copy Link closes it) →
   `danger`. Separators sit between groups only. A new action picks its group;
   it is never appended to the end.
3. **Labels are verb-first Title Case, without articles** ("Add Lesson
   Before"). An action on the menu's own entity drops its noun ("Rename", not
   "Rename Video"). A toggle names what it will do ("Mark as Done").
4. **Same action, same words, same icon** everywhere (`STANDARD_ACTIONS`).
   "Copy …" only means the clipboard; a second entity is "Duplicate". Say
   "Archive" when the app offers Unarchive, "Remove from …" when only a link is
   cut, "Delete" otherwise.
5. **An ellipsis means "asks for more first".** Set `opensDialog` on an item
   that opens a dialog, form or thread; never type "…" into a label.
6. **Destructive goes last, in red, in `danger`.** One that cannot be undone
   (Delete, Purge Export) confirms first, so carries the ellipsis; an undoable
   one (Archive, Remove from Pitch) acts at once.
7. **Hide what does not apply; disable what cannot run yet.** Omit an action
   that never applies in this state (read-only Version, Video never exported);
   disable one that applies but is blocked (first item's Move Up, a request in
   flight, transcription unfinished).
8. **Every item has an icon**, drawn by the primitive at one size. Show a
   `shortcut` wherever the action has one.
9. **One level of submenu at most**, for a choice among siblings (a Beat kind,
   a target Section). Past about a dozen items, move rare actions to the page.

Enforced by `action-menus.test.ts`: any raw `ContextMenu*` / `DropdownMenu*`
part outside a picker fails; a missing feature goes into `action-menu-model.ts`.

## React Router data flow

### Redirect from the action, not from an effect

When a fetcher action's sole job after success is to navigate, return
`redirect(...)` from the action instead of returning data and navigating from a
client-side `useEffect`. React Router handles fetcher redirects automatically.
The `useEffect` pattern is fragile: if any dep (e.g. an inline `onOpenChange`
prop) changes between renders, the effect re-fires and re-issues
`navigate(...)`, cancelling and restarting the in-flight navigation in a loop.

### Derive optimistic UI from `fetcher.formData`

For optimistic UI on fetcher mutations, derive the optimistic value from
`fetcher.formData` instead of mirroring it into `useState` + syncing back with
`useEffect`. When the fetcher is in-flight, `fetcher.formData.get("value")`
holds the pending value; when it settles, `formData` becomes `undefined` and the
component falls back to the revalidated loader data. Example:
`const optimistic = (fetcher.formData?.get("value") ?? loaderValue) as MyType;`.
This eliminates state-sync bugs and removes the need for `useEffect` entirely.

## Keyboard shortcuts

### The Animatic page answers the Video page's keys

Every Video page shortcut (`use-keyboard-shortcuts.ts`) is ported to the
Animatic page wherever it has a meaning there, with the same meaning — except
ARROW LEFT/RIGHT, which step the Animatic's playhead on purpose. A shortcut
added to the Video page gets the same decision at that moment. A new keyboard
surface uses `app/hooks/should-ignore-keyboard-shortcut.ts` rather than its own
input/Monaco/dialog test. Detail:
[`docs/KEYBOARD_SHORTCUTS.md`](./docs/KEYBOARD_SHORTCUTS.md).

## Front-end state

One pure reducer per surface. Events are facts (what happened), effects are
data the reducer returns for a thin runner to perform, and tests drive the
reducer with event sequences instead of rendering. No decision lives in
`useState` + `useEffect`. `scripts/check-frontend-state.ts` holds `useState`
counts and state-setting effects to a shrink-only allowlist. See
[`docs/FRONTEND_STATE.md`](./docs/FRONTEND_STATE.md).

## Display formatting

### One duration formatter

Every duration shown to a person — a Video's length, a clip timecode, an
Animatic's run time, a YouTube chapter — goes through `formatDuration` in
`app/lib/format-duration.ts`: `m:ss` under an hour, `h:mm:ss` from one.
`scripts/check-duration-format.sh` fails a file that hand-rolls it (seconds
`% 60` plus a two-digit `padStart`). Rounded estimates like an upload ETA
(`~1h 5m`) are a different thing and keep their own wording.

### One toast

Every toast comes from `@/components/ui/toast`, never straight from
`sonner`. That module clamps a toast's text to four lines with a "Show more"
toggle and gives every error toast a "Copy" action, so an enormous server
error stays readable and pasteable instead of filling the screen. Show a
caught error with `toastError(error, fallback)`. `scripts/check-toast-import.sh`
fails any other file that imports `sonner`.

## Interface design

### Deep modules

Prefer deep modules: small interface, deep implementation. A few methods with
simple params hiding complex logic behind them.

Avoid shallow modules: large interface with many methods that just pass through
to thin implementation. When designing, ask: can I reduce the number of methods?
Can I simplify the parameters? Can I hide more complexity inside?

### Design for testability

1. **Accept dependencies, don't create them** — pass external dependencies in rather than constructing them internally.
2. **Return results, don't produce side effects** — a function that returns a value is easier to test than one that mutates state.
3. **Small surface area** — fewer methods = fewer tests needed, fewer params = simpler test setup.

## Testing

Tests verify behavior through public interfaces, not implementation details.
Code can change entirely; tests shouldn't break unless behavior changed.

Mock at **system boundaries** only — external APIs, time and randomness, and the
file system or a database when a real instance isn't practical. Everything
inside the boundary goes in real: never mock your own classes, modules or
internal collaborators. When something is hard to test without mocking an
internal, redesign the interface.

Every test must be able to fail for a plausible real bug a user or caller
would see; if you can't name the bug, don't write it. For what earns a place,
component tests, worked examples, red flags, Remotion and TDD, read
[`TESTING_STANDARDS.md`](./docs/TESTING_STANDARDS.md).
