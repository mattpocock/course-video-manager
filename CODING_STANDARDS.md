# Coding standards

The rules a human or an agent holds in their head while writing and reviewing
code here.

## Effect and configuration

Wherever possible, use Effect primitives like `FileSystem` over promises. This
is so that we can make use of DI and type-safe errors from Effect. However,
Effect should not leak out into the user-facing API.

Read every environment variable a run needs at its start, not at the moment of
use. A `Config.string(...)` inside a branch that runs rarely turns a missing
`.env` line into a failure that appears only when that branch first runs — a
video export that concats and normalizes for thirteen seconds, then fails
because nobody set `OVERLAY_RENDER_CACHE_DIRECTORY`, and does it again on every
retry. Resolve the config at the edge (the layer, or the command's entry point)
so a missing variable stops the process before any work starts, and let the
error name the variable.

## Function signatures

Optional parameters passed to functions should be scrutinised extremely
carefully. They are a huge source of bugs (by omission). Prioritise correctness
over backwards compatibility.

## Types

### Every `any` is a leak

An `any` switches the type checker off for every value that flows through it,
and those values keep flowing long after the line that produced them. Write the
type you actually mean. A shape you know gets a name — one `interface` at the
top beats a cast at each of thirteen call sites. A shape you do not know yet
gets `unknown`, and then gets narrowed, which is the honest form of `any`: it
makes the reader prove the shape before using it. A shape that varies by caller
gets a generic **constrained** to the real thing, because `<R extends
LayerLive>` says what a bare `<R>` does not. A symbol or brand a library owns
gets the library's own exported id (`Runtime.FiberFailureCauseId`) rather than a
cast.

What a leak costs, from this repo: `makeLoader` took `runtime:
ManagedRuntime<any, any>` and left its `R` unconstrained. A route asked for a
service the runtime did not provide, `tsgo` stayed green across all 111 route
modules, and the Animatic page returned a 500 on every load. The `any` did not
cause the missing service — it removed the one thing that would have caught it.

An `any` survives review when a third-party type is genuinely `any` at the
boundary and nothing narrower type-checks. Contain it: cast once at the edge
into a named type, and keep the `any` out of the signature everything else
calls. An `any` in an exported signature leaks to every caller; an `any` inside
one function body does not.

A new `any` needs a reason in the PR. An `any` already sitting in a file you are
touching is an invitation, the same way an oxlint `correctness` warning is — a
file should leave review with fewer of them than it had.

## Course Versions

### A write to anything a Version owns goes through the Draft guard

A Section, a Lesson, a Video and everything hanging off them belong to a
CourseVersion, and only a Draft accepts writes: Pending and Published Versions
are immutable. `packages/core/services/draft-guard.server.ts` is the single
place that decides this. Every DB write entry point resolves its target's owning
Version through the `requireDraftVersionFor…` that matches the noun it is
writing — Section, Lesson, Learning Goal, Video, Clip, Chapter, Clip web link,
Overlay — and fails with a typed `VersionNotDraftError` when the Version is not
a Draft. The guard reads `commitState` with a `SELECT … FOR UPDATE`, so it is
only race-safe inside the SAME transaction as the write it protects.

**A NEW NOUN INHERITS THE GUARD FROM WHAT IT HANGS OFF.** If a row points at a
Video, a Clip or a Section, then a Version owns it too, however far from the
Course the noun feels while you are building it. Add its
`requireDraftVersionFor<Noun>` beside the others and call it from every write —
create, update, move and archive alike. A read never needs it.

The guard is not only about protecting a published Course from a late edit. It
is the only thing that tells a caller it is holding the WRONG VERSION of a row.
A Version copy gives every Video a new id, so a stale id still resolves, still
names a real Video with the right title, and still takes writes — the work
simply lands somewhere nobody is looking.

What the omission costs, from this repo: Clip Mockups and Clip Mockup Chapters
were left outside the closure on purpose, on the reasoning that a Clip Mockup is
pre-filming authoring data and sits outside the published write-closure. A
Version copy then gave one course a set of Draft Videos. Half an hour later an
authoring run wrote 190 Clip Mockups across six of those Videos — onto the
`v0.0.1` rows, a **published** Version — and ten hours after that a second run
wrote 57 Chapters onto eleven of them the same way. Every one of those ~250
writes succeeded and returned a row. The author opened the Animatic on the
Draft, which is the Version the app shows, and saw no Chapters and no Chapter
controls at all, because those controls hide themselves when a Video has none.
`requireDraftVersionForVideo` would have refused the first write of the first
run and the whole thing would have stopped there. The reasoning about the
write-closure was sound and the conclusion was still wrong: the guard's second
job is catching a stale id, and no noun that a Version owns is exempt from that.

A noun survives review without a guard only when no Version owns it — a
standalone or pitch-bound Video belongs to no CourseVersion, and the guard
already passes for that case rather than needing to be skipped. "This noun is
not part of the published artifact" is not the test; "no row above this one
reaches a CourseVersion" is.

## Entities and their actions

### Every entity is right-clickable

Every entity the app renders — a Course, Section, Lesson, Video, Clip, Chapter,
Beat, Pitch, Deliverable — answers a right-click with a context menu. An entity
with actions and no right-click handler is an unfinished entity.

The right-click menu and the entity's **Actions menu** (the `Actions` dropdown,
or the `…` button on the entity itself) offer **the same set of actions**. They
are two doors into one list: an action added to one appears in the other, so
share the menu items between them rather than writing each list twice.

### Order the actions, and group the related ones

Both menus present that shared list in a deliberate order, most-reached action
first and the destructive ones (archive, delete) last. Related actions sit
together in a group — everything that moves the entity, everything that exports
it, everything that ends its life — with `DropdownMenuGroup` and a
`DropdownMenuSeparator` between groups, and a `DropdownMenuLabel` where the
group's name helps the reader. Adding an action means choosing the group it
belongs to, not appending to the end of the list.

### Context menu items carry an icon

Context menu items should always include a leading icon (from `lucide-react`),
matching the style of the surrounding items. When adding a new menu item, pick
an icon that conveys the action.

### Filters stay in sync with the entity

Filters must stay in sync with the shape of the data they filter. When a new
field is added to an entity that affects what something "is" (status, category,
state), every filter, count, and badge that surfaces that concept must be
updated to take the new field into account. Filters are part of the entity's
definition, not a one-time UI feature — drift between them and the data shape
produces silently-wrong results.

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

The author walks an Animatic with the same habit he walks a filmed Video with,
so the two screens must not disagree about a key. Every shortcut the Video page
has (`features/video-editor/hooks/use-keyboard-shortcuts.ts`) is **ported to the
Animatic page where it has a meaning there**, and it keeps the same meaning:
SPACE plays and pauses where the playhead is, RETURN plays the selected item
from its start, the arrows move the selection and do not touch playback, HOME and
END go to the ends, L and K are 2x and 1x.

Port a key only if the Animatic has something for it to act on — the Animatic is
read-only, so DELETE, ALT+ARROW (reorder) and B (pause marker) have no
equivalent and are left out. When a shortcut is ADDED to the Video page, decide
at that moment whether it makes sense on the Animatic page, and add it there too
or say in the code why it cannot be. The two screens also hold the same shape:
the list of moments on the left, the picture on the right.

Both pages share one guard for when a key is not the page's to take —
`app/hooks/should-ignore-keyboard-shortcut.ts`. A new keyboard surface uses it
rather than writing its own test for inputs, Monaco and dialogs.

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

Writing, changing or reviewing a test — for the worked good and bad examples,
the red-flag list, the rule for Remotion renderer packages, and the
vertical-slice TDD loop, read
[`TESTING_STANDARDS.md`](./docs/TESTING_STANDARDS.md).
