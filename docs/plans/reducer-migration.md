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

## Batch 5 — Posting pages, part 1: post page and Shorts modal (score 142)

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

## Batch 6 — Small modals and forms (score 126)

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

## Batch 7 — Video editor media sync (score 111)

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

## Batch 8 — Command palette (score 102)

`features/diagrams/palette/use-palette.ts` is already half migrated:
`navReducer` holds navigation, but `open`, `hasSelection`, `selectedIcon`,
`busy`, `recentIcons`, `components`, `diagramHits` and `searching` sit beside
it in nine `useState`s, and three effects write them. Grow `navReducer` into a
`paletteReducer` that owns all of it. Searching and loading the component list
become effects that report their results as events.

- `palette-nav.test.ts` becomes the base of the palette reducer tests, so
  rename it and grow it. Do not keep two files. `palette-model.test.ts`,
  `recent-icons.test.ts` and `grid-nav.test.ts` test pure helpers and stay.

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
