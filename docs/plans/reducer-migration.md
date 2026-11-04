# Reducer migration

Move the 24 files in `scripts/frontend-state-allowlist.json` onto the pattern in
[`FRONTEND_STATE.md`](../FRONTEND_STATE.md): a pure reducer for the surface,
events that are facts, effects that are data, and a thin effect runner. The work
is split into nine batches. Each batch is sized so one agent can ship it in one
PR.

The point is fewer tests as well as better code. **Every batch deletes the
component and hook tests its reducer tests make redundant**, and it adds no new
component test. Most of these files have no component tests today. That is not
because the logic is covered somewhere else. It is because rendering a
13-`useState` route to test it was too costly for anyone to do. Each batch adds
the reducer tests that should have existed and, where its section says so,
deletes the old tests.

## How the batches were ranked

Score per file = (`useState` calls + 2 × effects that set state + 2 × commits
whose subject mentions fix/bug/regress) × commits in the last 90 days, measured
on 2026-10-07 with `git log --follow`. A batch's score is the sum of its
files' scores. The diagram playground goes first even though batch 2 has a
higher sum. Its last two fixes (`aaac954c` "opening a diagram no longer writes
its head" and `ed906519` "a diagram that hasn't loaded can't be edited", both
2026-10-06) were state-lifecycle bugs, which is exactly the class of bug this
migration removes.

| File (under `apps/local/app/`)                                 | useState | effect sets state | fixes | commits 90d | score | batch |
| -------------------------------------------------------------- | -------: | ----------------: | ----: | ----------: | ----: | ----: |
| `routes/diagram-playground.$diagramId.tsx`                     |        8 |                 3 |     4 |           9 |   198 |     1 |
| `features/video-editor/video-editor.tsx`                       |        6 |                 0 |     1 |          22 |   176 |     2 |
| `routes/_app.courses.$courseId.publish.tsx`                    |        5 |                 1 |     2 |          16 |   176 |     4 |
| `components/app-sidebar.tsx`                                   |        5 |                 1 |     3 |          13 |   169 |     2 |
| `features/diagrams/palette/use-palette.ts`                     |        9 |                 3 |     1 |           6 |   102 |     8 |
| `features/video-posting/shorts-posting-modal.tsx`              |        5 |                 2 |     0 |           8 |    72 |     5 |
| `features/video-posting/post-page.tsx`                         |       10 |                 2 |     0 |           5 |    70 |     5 |
| `features/video-editor/preloadable-clip.tsx`                   |        2 |                 2 |     1 |           7 |    56 |     7 |
| `features/video-editor/components/recording-session-panel.tsx` |        4 |                 3 |     0 |           5 |    50 |     7 |
| `routes/_app.pitches.$pitchId.tsx`                             |        7 |                 1 |     0 |           5 |    45 |     6 |
| `routes/_app.videos.$videoId.social.tsx`                       |       13 |                 0 |     0 |           3 |    39 |     3 |
| `features/article-writer/use-context-model.ts`                 |        5 |                 0 |     0 |           7 |    35 |     3 |
| `features/animatic/animatic-comments.tsx`                      |        6 |                 0 |     0 |           5 |    30 |     6 |
| `features/lesson-writer/autofill-description-modal.tsx`        |        2 |                 2 |     0 |           5 |    30 |     6 |
| `features/video-posting/ai-hero-page.tsx`                      |        5 |                 2 |     0 |           3 |    27 |     9 |
| `routes/_app.videos.$videoId.post.tsx`                         |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.skills-changelog.tsx`             |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.ai-hero.tsx`                      |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.newsletter.tsx`                   |       13 |                 0 |     0 |           2 |    26 |     3 |
| `features/video-posting/social-page.tsx`                       |        5 |                 1 |     0 |           3 |    21 |     9 |
| `features/video-posting/skills-changelog-page.tsx`             |        4 |                 2 |     0 |           2 |    16 |     9 |
| `components/video-file-paste-modal.tsx`                        |        2 |                 2 |     0 |           2 |    12 |     6 |
| `components/capture-camera-modal.tsx`                          |        3 |                 3 |     0 |           1 |     9 |     6 |
| `features/video-editor/use-speech-detector.ts`                 |        1 |                 2 |     0 |           1 |     5 |     7 |

Refresh the counts with `node scripts/check-frontend-state.ts --report`.

## Every batch, the same definition of done

- The surface's decisions live in a `*-reducer.ts` that does not import React,
  using `useEffectReducer`, with the effect handlers in one hook.
- The reducer tests send real event sequences through `ReducerTester` and
  assert `getEffects()` as a whole list.
- **Deleted:** every component or hook test that checks a rule the reducer
  tests now cover. The tests named under each batch are the ones that exist
  today. Look again when you start, because new ones may have been added.
- The batch's entries in `scripts/frontend-state-allowlist.json` are deleted,
  or lowered if a file is still over the limit for a reason the PR explains.
  `pnpm run check` fails until this is done.
- No behavior change. The PR is a refactor plus tests, with nothing else in it.

## Batch 1 — Diagram playground lifecycle (score 198) — Done

`routes/diagram-playground.$diagramId.tsx`. There are eight `useState`s:
`headStatus`, `pendingRestore`, `preserving`, `creating`, `editorConnected`,
`windowFocused`, `isFocusMode` and `refreshKey`. Three effects write them. This
is the load → ready → editing → restore lifecycle that broke twice on
2026-10-06. Fold it into a `diagramPlaygroundReducer` with events such as
`head-loaded`, `head-load-failed`, `snapshot-restore-requested`,
`editor-connected`, `window-blurred` and `create-clicked`, and effects such as
`save-head`, `restore-snapshot` and `create-diagram`. Write regression tests
for the two fixes first, as event sequences.

- Delete or trim: in `features/diagrams/head-autosaver.test.ts` (which runs a
  real tldraw store on real timers), keep the debounce and store-boundary cases
  and delete any case that checks a status transition the reducer now owns.

**Done.** `features/diagrams/diagram-playground-reducer.ts` owns the head
lifecycle (`loading | failed | ready`), the restore dialog, preserving,
creating, the clip-snapshot handshake and the window/video-editor flags. The
effect runner is `use-diagram-playground-reducer.ts`; the route keeps only
bridges that dispatch. The route has no `useState` left, so both of its
allowlist entries are gone (17 → 16 `use-state`, 12 → 11 `effect-sets-state`).

- Tests: `apps/local` went from 3715 to 3724 (+9 reducer scenarios, written
  first for `aaac954c` and `ed906519`). `head-autosaver.test.ts` kept its 3
  cases: the two debounce/store-boundary ones as they were, and the failed-load
  case cut down to "nothing saves while detached" with its status assertions
  removed, because `HeadStatus` now lives in the reducer and the autosaver
  only does `attach`/`detach`. No component test rendered this route, so none
  could be deleted.
- Two edge cases changed on purpose: a restore that finishes after the page
  has moved to another diagram is now ignored (as a late head load already
  was), and a remounted editor reloads the head rather than staying empty.
- Verified with `verify-cvm` on a test clone: opening and reloading a diagram
  never PATCHes the head, an edit autosaves once, a failed head load stays
  read-only with no PATCH until Retry, and switching diagrams saves the one
  being left before loading the next.

## Batch 2 — Modal bags: sidebar and video editor (score 345) — Done

`components/app-sidebar.tsx` has five booleans: `isAddCourseOpen`,
`isAddVideoOpen`, `isSpacedeskOpen`, `sheetOpen` and `isCreatingDiagram`.
`features/video-editor/video-editor.tsx` has five `is…ModalOpen` booleans and
`suggestionState`. Only one modal can be open at a time, so each set becomes
one `openModal` union in a small reducer. The video editor's `suggestionState`
moves into the reducer as well. The sidebar's two earlier bugs (#1682, #1697)
came from doing work in an effect. Keep creating a diagram as an effect the
reducer declares from `create-diagram-clicked`.

- Delete: no component test renders either file today. Add none.

**Done.** `components/app-sidebar-reducer.ts` holds the sidebar's
`openModal` (`add-course | add-video | spacedesk`), the mobile sheet and the
in-flight Diagram create (later, #2054: the Spacedesk dialog is gone;
`spacedesk-clicked` declares `wake-spacedesk` and the outcome toasts); `create-diagram-clicked` declares `create-diagram`,
and the outcome comes back as `diagram-created` (which declares
`open-diagram`) or `diagram-create-failed` (which declares `show-error`). The
effect runner is `components/use-app-sidebar-reducer.ts`, and the
close-the-sheet-on-navigation effect is now a bridge that dispatches
`location-changed`. `features/video-editor/editor-modals-reducer.ts` holds the
editor's `openModal` (`add-video | paste-file | rename-video | copy-video |
create-video-from-selection`) and the Suggestions panel's `suggestion`;
closing the paste dialog declares `refresh-video-files`, which used to be an
inline `revalidator.revalidate()` in `EditorModals`. Its runner is
`hooks/use-editor-modals-reducer.ts`. The context swaps eight `is…`/`setIs…`
pairs and `setSuggestionState` for `openModal`, `modalDispatch` and a stable
`onModalOpenChange` per dialog: stable because `SpacedeskModal` and
`AddVideoModal` close themselves from effects that list `onOpenChange`. Neither
file has a `useState` left, so both `use-state` entries are gone (16 → 14).

- Tests: `apps/local` went from 3993 to 3999 (+6 reducer scenarios: four for
  the sidebar, including the in-flight double click that #1697 moved out of an
  effect, and two for the editor). No component test rendered either file, so
  none could be deleted.
- The sheet stays a separate boolean rather than joining `openModal`: a dialog
  opened from inside the mobile sheet stacks on top of it today, and folding
  the two together would have closed the sheet.
- `modal-dismissed` names its dialog and is ignored unless that dialog is the
  open one, so a late close never shuts a different dialog, as separate
  booleans never could. Opening a second dialog now closes the first, but a
  modal dialog blocks the menus that open the others, so nobody could reach
  that before either.

## Batch 3 — Writer context panel, five routes and one hook (score 178) — Done

The five posting routes `_app.videos.$videoId.{post,social,ai-hero,newsletter,skills-changelog}.tsx`
each declare the same 13 `useState`s for the context panel: enabled files,
sections and transcript, plus the preview, add-link, file, paste and delete
modals. `features/article-writer/use-context-model.ts` holds the same state for
the Article Writer. Write one `contextPanelReducer` and use it in all six
places. This batch removes about 70 `useState` calls, and each one is a place
where the five routes could drift apart.

- Delete: there are no route or hook tests for this today. The reducer tests
  replace all five copies, so add no per-route tests.

**Done.** `features/article-writer/context-panel-reducer.ts` owns what goes
with a writing request (files, chapters, whole transcript, page fields, links,
course structure, memory, beats, script, animatic, diagram text, and the memory
text) and the posting routes' `openModal` (`preview-file | add-link |
edit-file | paste-file | delete-file`). The Article Writer starts it from what
it has stored and declares `store-toggle` / `store-disabled-links` when a
remembered source flips; the posting routes start from the defaults and never
store, as before. Editing a file declares `read-video-file`, and the content
comes back as `video-file-read`. The sources list and the prompt texts are
selectors (`context-panel-selectors.ts`). The runner is
`use-context-panel-reducer.ts`; `use-context-model.ts` builds the writer's
model on it, and the five routes share `usePostingContextPanel`
(`features/video-posting/posting-context-panel.tsx`), which returns the panel's
props and its five dialogs. All six files are at zero `useState` (70 before:
13 in each route, 5 in the hook), so their six `use-state` entries are gone
(14 → 8).

- Tests: `apps/local` went from 4862 to 4871 (+9 reducer scenarios in
  `context-panel-reducer.test.ts`). No route or hook test existed, so none
  could be deleted.
- One edge case changed on purpose: when two files are opened for editing in
  quick succession, the one clicked last opens; before, whichever read
  finished last did.
- Verified with `verify-cvm` on a test clone: on the post page a chapter
  untick, the course-structure tick, a pasted file (created and ticked), its
  preview, edit and delete dialogs and the add-link dialog all behave as
  before; the other four routes open the paste dialog from the shared hook;
  in the lesson-body writer, unticking a chapter, ticking course structure and
  switching all links off change the token counts, and after a reload the two
  remembered toggles stay while the chapter resets. The Write Ledger shows no
  database write.

## Batch 4 — Publish page (score 176) — Done

`routes/_app.courses.$courseId.publish.tsx`: `bumpLevel`, `description`,
`includeTodoLessons`, `publishStarted` and `autofillUploadId`, plus an effect
that follows the upload. Make it a `publishPageReducer`. Starting a publish or
an autofill becomes an effect, and the upload manager's progress comes back as
events.

- Delete: no tests render this page.

**Done.** By the time this batch started, #2313 had already dropped
`autofillUploadId` (the Autofill became the hidden first step of one Publish
press), leaving four `useState`s and the effect that re-read the loader when
the Publish Job settled. `features/publish/publish-page-reducer.ts` owns the
form (`bumpLevel`, `description`, `includeTodoLessons`), `publishStarted`, and
whether this Course's Publish was last seen running. `publish-clicked` carries
what the page knew (Course, latest Version, base semver, Placeholder Floor,
whether there are Autofill Candidates) and declares one `start-publish`, with
`autofillVersionId` on it as the order (Autofill first, the Publish queued
behind it, as before), then `open-course`. The jobs list comes back as
`publish-job-observed`, from a bridge effect, and a running → settled change
declares `revalidate-readiness`. The version name is a selector
(`selectVersionName`, with `readVersionBase` for the previous name). The
runner is `use-publish-page-reducer.ts`. The button's label and enabled rule
stay in `decidePublishAction`. The route has no `useState` left, so its
`use-state` entry is gone (8 → 7).

- Tests: `apps/local` went from 4824 to 4830 (+6 reducer scenarios in
  `publish-page-reducer.test.ts`). No test rendered this page, so none could
  be deleted.
- One guard is new but changes nothing a user can reach: once Publish is
  pressed the reducer ignores form edits and a second press, where before
  only the disabled controls stopped them.

## Batch 5 — Posting pages, part 1: post page and Shorts modal (score 142) — Done

`features/video-posting/post-page.tsx` has 10 `useState`s:
`isGeneratingTitle`/`Description`, `confirmOverwriteField`,
`pendingGeneratedText`, `currentFieldText`, `isCheckingExport`,
`isConvertingShortLinks`, and others. `shorts-posting-modal.tsx` has
`postState`, `postedStatus`, generation and link conversion. Put the flow they
share, "generate text → confirm overwrite if there is text already → apply",
into a `generatedFieldReducer` that batch 9 reuses. The rest of each page
becomes a reducer of its own.

- Keep `lib/youtube-metadata.test.ts`, which tests the pure YouTube metadata
  validation both pages and the posting Jobs share. The reducer calls it; it
  does not move into the reducer.

**Done.** `features/video-posting/generated-field-reducer.ts` is the shared
flow: `generate-clicked` (with the field's text as it was, and whether to ask
before replacing it) declares `generate-text`; `text-generated` declares
`apply-field-text` straight away for a blank field, or holds the new text for
Replace / Cancel (`overwrite-confirmed` / `overwrite-cancelled`). One field
generates at a time. `text-offered` is the same ask-then-apply for a ready-made
text (the Pitch's YouTube title). It does not own the field's text: the pages
keep that per Video in `localStorage`, as before, so events carry it and
`apply-field-text` changes it. A surface reducer keeps it as `fields` and hands
it those six actions.

`post-page-reducer.ts` owns the rest of the post page: visibility, the
selected Thumbnail (deleting the selected one clears it), the remembered
YouTube id (`video-opened` declares `read-stored-youtube-video-id`; the jobs
list's `youtube-upload-succeeded` declares `store-youtube-video-id`), Post
(`check-export`, then `start-youtube-upload` with `exportFirst` when there is
no Exported Video), and short links (`create-short-links`, whose
`short-links-created` rewrites the description as it was when pressed). The
upload's display, the metadata problem, whether Post can be pressed and the
generation request are selectors. `shorts-posting-reducer.ts` owns the
Short's title (renamed on blur; a refused rename puts the saved title back),
the once-per-mount description generated on open, where the Short was already
posted, Post Short (`check-vertical-export`, then one `start-short-posting`
naming the vertical export, YouTube and Buffer as data) and short links. The
Short and the posting mode come in on the events, because the portrait studio
keeps the modal mounted while they change. The runners are
`use-post-page-reducer.ts` and `use-shorts-posting-reducer.ts`, sharing
`posting-requests.ts` for the generate and short-link calls. Both files are
at zero `useState` (10 and 5 before) and neither has an effect that sets
state, so their four allowlist entries are gone (`use-state` 7 → 5,
`effect-sets-state` 9 → 7).

- Tests: `apps/local` went from 4825 to 4839 (+8 scenarios in
  `post-page-reducer.test.ts`, +6 in `shorts-posting-reducer.test.ts`). No
  component test rendered either file, so none could be deleted;
  `lib/youtube-metadata.test.ts` and `convert-short-links.test.ts` stay.
- One guard is new but changes nothing a user can reach: a second Post or
  Convert press while the first is in flight is ignored, where before only the
  disabled button stopped it. A posted-status answer for a Short the modal is
  no longer open on is ignored, as the old effect's cancel flag did.

## Batch 6 — Small modals and forms (score 126) — Done

`routes/_app.pitches.$pitchId.tsx` (the pitch form fields and the
`saveState` autosave), `features/animatic/animatic-comments.tsx` (comment
open/draft/edit), `features/lesson-writer/autofill-description-modal.tsx`
(`seeded` written from an effect), `components/video-file-paste-modal.tsx` and
`components/capture-camera-modal.tsx` (the media stream lifecycle). Each one is
small and independent. If the PR gets too big, ship the first two and the last
three separately.

- Delete: no component tests exist for these five. The camera modal's
  `getUserMedia` stays inside an effect handler, and `stream-acquired` and
  `stream-failed` come back as events.

**Done.** By the time this batch started, #2279 had already deleted
`components/capture-camera-modal.tsx` (the CVM recorder became the only
Recorder), and its allowlist entry had gone with it, so four files were left.

`features/pitches/pitch-form-reducer.ts` owns the Pitch page's six text
fields and the autosave. `field-edited` declares `wait-for-edit-pause` with
an `editId`; only the latest edit's `edit-pause-elapsed` declares
`save-pitch-field`, and the indicator reads Saving… until every save has
answered (`pitch-field-saved`), then declares `reload-pitch` and
`wait-before-hiding-saved`. The runner is `use-pitch-form-reducer.ts`.
`features/lesson-writer/autofill-description-reducer.ts` owns the SEO
Description modal: `modal-opened` declares `load-lesson-writer-data` once per
mount, and `lesson-writer-data-loaded` declares `autofill-description` itself
when the description is blank and the body is not. That rule was the
`seeded` effect. Save declares `save-description` and `close-modal`; the runner
(`use-autofill-description-reducer.ts`) keeps the save on a fetcher, so the
page still revalidates after the modal unmounts.
`components/video-file-paste-reducer.ts` owns the Paste from Clipboard dialog:
`content-pasted` carries the Video's paths and names the file
(`generatePastePath`), and `create-clicked` declares `create-file`. The
fetcher's answer comes back through a bridge as `file-created`, which declares
`close-modal` and `report-file-created`. The two focus moves are effects. The
Animatic's comments split into two surfaces, because each comment keeps its
own writer and shows its own refused write:
`features/animatic/animatic-comment-thread-reducer.ts` (the popover, the
target frozen by `thread-shown` until `thread-hidden`, and the new comment) and
`animatic-comment-edit-reducer.ts` (editing one comment in place, and deleting
it). Their runners are in `use-animatic-comment-reducers.ts`, with the
fetcher-backed writer. `useStageComments` keeps its one popover boolean, which
the "may keep `useState`" rule allows. The pitch route, the autofill modal and
the paste modal have no `useState` left, and `animatic-comments.tsx` is down
from 6 to 1. All four allowlist entries are gone (`use-state` 5 → 3,
`effect-sets-state` 7 → 5).

- Tests: `apps/local` went from 4881 to 4899 (+18 reducer scenarios: 4
  pitch form, 4 autofill description, 5 paste, 3 comment thread, 2 comment
  edit). No component test rendered any of these, so none could be deleted.
- Some edge cases changed on purpose. Editing a second Pitch field within the
  600 ms pause used to drop the first field's save; now it sends it at once.
  Leaving the page during the pause used to rely on a timer outliving the
  route; now the runner sends the waiting edit as it unmounts. A failed Pitch
  save now toasts and never shows Saved. An old Saved timer can no longer hide
  a newer Saving…, and a failed autofill or description load shows an error
  in the modal instead of going to the error boundary or loading forever.
- A trap found while verifying, **fixed 2026-10-27 in #2389 (#2386)**: given
  its initial state as a function, the package's `useEffectReducer` flushed
  once on mount, and StrictMode's second mount pass flushed again, which threw
  away an effect declared by an event dispatched on mount. The SEO Description
  modal mounts already open, so it sat on Loading… for good. This batch worked
  round it by passing an initial state object; the fix is in the hook itself
  (`hooks/use-effect-reducer.ts`, which every runner now imports), so either
  form is safe.
- Verified with `verify-cvm` on a test clone, with the Tiny Course and a Pitch
  and two Clip Mockups made for the run. On the Pitch page, an edit to a
  second field within the pause saves both fields, leaving through the back
  link right after typing still saves, and the indicator goes Saving… →
  Saved → gone. The SEO Description modal loads the description, saves an
  edit and closes; reopened on a blank description, it autofills by itself
  and shows the error (the model is unreachable on a clone). The editor's Add
  Note dialog focuses the paste area, names pasted text `notes.md`, then
  `notes-1.md`, and a pasted image `diagram-1.png`, creates the file, closes,
  and reopens empty. On the Animatic, a comment added from a row's badge, from
  the stage button and from a row's right-click menu each lands on its own
  Clip Mockup, trimmed; edit and delete work from the comment's `…` menu. The
  Write Ledger shows only those tables.

## Batch 7 — Video editor media sync (score 111) — Done

`features/video-editor/preloadable-clip.tsx` (`preloadState`, overlay time),
`components/recording-session-panel.tsx` (elapsed timer, focus flags) and
`use-speech-detector.ts`. These are effects that copy `<video>`, timer and focus
events into local state. Make them dispatch facts (`clip-preloaded`,
`window-focused`, `speech-started`) into small reducers, or into
`videoStateReducer` where that state already lives. The elapsed timer gets
its time from a `tick` event that carries `at`, so the reducer never reads the
clock.

- Delete: none render these. `use-audio-boost.test.ts` and
  `use-ensure-obs-profile.test.ts` cover other hooks and stay.

**Done.** By the time this batch started, `use-speech-detector.ts` was gone:
#2267 made the speech state machine `speech-detector-reducer.ts`, and #2279
deleted the hook with the OBS Recorder. Two files were left, both over only
the `effect-sets-state` limit. `use-ensure-obs-profile.test.ts` had gone the
same way.

`features/video-editor/session-panel-reducer.ts` owns a Recording Session
panel's header. `session-heard` (on mount and whenever the panel's session
changes) declares `tick-every-second` when a session starts recording, or
starts again with a new `startedAt`, and stops it when recording ends; the
clock comes back as `clock-ticked` with `at` and whether a Diagram is open,
so the reducer never reads the clock. The two focus trackers report through
bridges as `diagram-focus-changed` / `browser-focus-changed`. The elapsed
seconds and which focus indicator shows are selectors
(`selectElapsedSeconds`, `selectFocusIndicator`); the panel maps the
indicator to its icon and copy. The runner is
`hooks/use-session-panel-reducer.ts`.
`features/video-editor/preloadable-clip-reducer.ts` owns one preloaded
Clip's `preload` and its Overlay playhead. The rAF loop reports
`clip-preloaded` when the muted `<video>` reaches the Clip's start, which
declares `park-video` (pause there, sound back on) and
`report-preload-complete` once, however many frames report it; the loop,
`seeked` and `timeupdate` report `playhead-moved`. The runner is
`hooks/use-preloadable-clip-reducer.ts`, whose `reportPlayhead` dispatches
only when the time changed, because a dispatch re-renders the Clip and the
loop reads the `<video>` every frame. The loop still pauses and rewinds
the `<video>` itself at the Clip's end: that writes no state. Neither file
has a `useState` left, so both `effect-sets-state` entries are gone (5 → 3).

- Tests: `apps/local` went from 4953 to 4959 (+4 scenarios in
  `session-panel-reducer.test.ts`, +2 in `preloadable-clip-reducer.test.ts`).
  No component test rendered either file, so none could be deleted;
  `use-audio-boost.test.ts` stays.
- Verified with `verify-cvm` on a test clone with the Tiny Course. The
  editor's Clip preloads and parks at its start (paused, unmuted, at 0.5 s);
  played muted, it runs through and stops and rewinds at its end; deleting
  the Clip shows the Deleted clips panel, and Restore puts it back (the
  Write Ledger shows only `clip`, `video` and `course_version`). Played
  unmuted, the headless browser's `<video>` holds at its start, most likely
  because the audio boost's `AudioContext` is made on mount, before any
  gesture (a fresh one made after a key press plays unmuted fine); this batch
  does not touch the audio path. A recording session's timer and focus indicator need
  a live Recorder, which a clone does not have, so the reducer tests are
  their only check here.

## Batch 8 — Command palette (score 102) — Done

`features/diagrams/palette/use-palette.ts` is already half migrated:
`navReducer` holds navigation, but `open`, `hasSelection`, `selectedIcon`,
`busy`, `recentIcons`, `components`, `diagramHits` and `searching` sit beside
it in nine `useState`s, and three effects write them. Grow `navReducer` into a
`paletteReducer` that owns all of it. Searching and loading the component list
become effects that report their results as events.

- `palette-nav.test.ts` becomes the base of the palette reducer tests, so
  rename it and grow it. Do not keep two files. `palette-model.test.ts`,
  `recent-icons.test.ts` and `grid-nav.test.ts` test pure helpers and stay.

**Done.** The batch's premise held: nine `useState`s (the plan's eight plus
`componentUnderEdit`) and three effects that set state. `palette-nav.ts` is
gone; `features/diagrams/palette/palette-reducer.ts` owns the page stack it
held and everything that sat beside it: `open`, the selection as of the
summon, the recents, the component library, the component under rename,
diagram hits, `searching` and the spinner. `palette-summoned` carries the
page, the selection and the stored recents, all read by the caller, so the
reducer never reads the editor or storage. Leaving or entering a page is
one rule applied after every event: entering the library declares
`list-components`; entering the diagram search, or typing on it, declares
`search-diagrams` with its `seq` and debounce as data (`exec.replace`, so a
newer search cancels a waiting one), and `diagrams-found` for an older
`seq` is ignored. Enter on a name page is one `name-submitted`, and the page
decides whether it saves a component, renames one or renames the Diagram.
Every insert, save, rename, delete, root command and toast is an effect
(`insert-icon`, `save-component`, `report-error`, …), and its outcome comes
back as an event; the spinner is `wait-for-spinner`, so it still shows only
past 150 ms. The root rows and the filtered library are selectors. The
runner is `use-palette.ts`, which keeps the two bridges (the summon
shortcuts and the `max-shapes` listener). The hook has no `useState` left,
so both of its allowlist entries are gone (`use-state` 3 → 2,
`effect-sets-state` 3 → 2).

- Tests: `palette-nav.test.ts` became `palette-reducer.test.ts` and went
  from 18 to 25 cases: the 18 page-stack cases folded into 7 scenarios, plus
  18 for the rest (a click away closes it, Cmd+F a second time searches
  again, a root command fires and closes, a stale search
  answer is ignored, icons land / hit the cap / are replaced, components are
  listed, inserted, saved, renamed and deleted, a vanished component drops
  its tile, a Diagram is gone to and renamed). The palette folder went from
  61 to 68. `palette-model.test.ts`, `recent-icons.test.ts`,
  `grid-nav.test.ts` and `palette-shortcuts.test.ts` stay. No component
  test rendered the palette, so none could be deleted.
- Two edge cases changed on purpose. A second Enter on a component while
  its insert or save is in flight is ignored, where before both ran. A
  renamed component goes back to the library at once, showing its new name,
  and the library is listed once on the way in; before, the page waited for
  one list and then listed again.
- Verified with `verify-cvm` on a test clone, on two Diagrams made for the
  run. Ctrl+K with nothing selected shows no Replace or Save rows; an icon
  inserted from the grid lands, closes the palette and is stored as recent;
  with it selected, Replace and Save appear, and Replace rewrites it in
  place. Save as component blocks an empty name, then saves and closes; the
  library lists and filters it, renames it (back on the library with the new
  name), inserts it (closes, a second shape on the canvas) and deletes it
  (its tile goes). Ctrl+F opens on Recent, Esc backs out to the root, Ctrl+F
  again searches again, typing searches by name; picking a hit goes to that
  Diagram and closes. Rename diagram saves the trimmed name. Backspace pops
  only an empty query and never closes; Esc and Ctrl+K close at the root.
  The Write Ledger shows only `diagram` and `diagram_component`, and the
  console has no errors.

## Batch 9 — Posting pages, part 2 (score 64)

`features/video-posting/ai-hero-page.tsx`, `social-page.tsx` and
`skills-changelog-page.tsx` reuse batch 5's `generatedFieldReducer` for SEO and
caption generation, and share the "check export, then store the slug or id"
flow with `post-page`. `justCopied` and `justCopiedAll` are presentational and
can stay as `useState` once the page is under the limit.

- Delete: no component tests exist for these pages.

## Not in a batch

- **`course-view-reducer.ts` modal booleans.** It is already a reducer, so the
  guard does not flag it. Its nine `is…ModalOpen` flags should become one
  `openModal` union, the same change as batch 2. Do that whenever someone is
  next working in that file.
- ~~**The upload manager's snapshot-diff planner** (`planUploadReactions`).~~
  **Deleted** in sidecar batch 8 (#1930), with `upload-reducer.ts` and
  `upload-manager-integration.test.ts`: every background job is a Job, and
  the jobs reducer declares its toasts with `exec`.
- **`upload-row.test.tsx`** (285 lines, rendered). A rendered test of row
  labels and progress-bar visibility. Once those decisions are selectors in
  `features/jobs/jobs-selectors.ts` (`upload-selectors.ts` is deleted), most of its cases can become selector tests. This
  belongs to the test-pruning plan, not this one.
