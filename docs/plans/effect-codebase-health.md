# Plan: Effect codebase health and type-aware lint

Measured 2026-10-06 on `origin/main` (2795ec48) in a scratch worktree. Counts below
come from real runs, not estimates. The plan is advisory-first: a rule only
becomes an error once it is green and a documented coding standard says why.

## Current state

- **Typecheck:** `tsgo` from `@typescript/native-preview` 7.0.0-dev.20260707.2,
  one run per package through turbo. That build is stale: `typescript@7.0.2` is
  now `latest` on npm. No TS plugin runs in tsgo, so the Effect language service
  has never run in CI or in the typecheck. (Since replaced by `typescript@7.0.2`
  `tsc`. See the Phase 1 status.)
- **Lint:** `oxlint` 1.85, syntax-only, in 0.26s. `correctness` is set to `warn`,
  and today it gives **12 warnings**. The only error-level rule is
  `no-restricted-globals` (localStorage), because it encodes a standard.
  `require-yield` is off for Effect generators.
- **Other gates:** dependency-cruiser runs per package. Five `scripts/check-*.sh`
  grep guards run in pre-commit and CI with `--all`. `pnpm run check` is the CI
  job.
- **Effect:** 3.22 (`^3.17.1`), with `@effect/platform`, `cli`, `cluster` and
  `vitest`.
  - Usage counts: 396 files import `effect`, 1138 `Effect.gen`, 41
    `Effect.Service` classes and only 1 `Context.Tag`.
  - Layers are composed in `layer.server.ts`. Seven `ManagedRuntime`s exist.
  - Routes run Effects through `makeLoader`/`makeAction` in
    `route-action.server.ts`. That file maps tagged errors to HTTP statuses.
  - Errors use 67 `Data.TaggedError`s and 0 `Schema.TaggedError`s. Schema
    appears in 46 files.
  - Escape hatches outside tests: `Effect.promise` 48, `Effect.die` 68,
    `catchAll(() => succeed/void)` 32, `as any` 21, and `Effect.run*` 15 hits
    in 12 files.

## What the tools can do (Oct 2026)

- **`@effect/language-service` 0.87.3** is the TS 5/6 plugin. Its README
  points TS 7 users to `@effect/tsgo`.
  - Two ways to run it in CI: `effect-language-service patch` patches `tsc`, or
    `diagnostics --project` runs without patching. Neither runs inside tsgo.
  - On this repo the TS-5 `diagnostics` run took **264s for apps/local**.
- **`@effect/tsgo` 0.48.1** (2026-10-05) is Effect's answer for tsgo: TypeScript-Go
  with the language service built in. It supports **only `typescript@7.0.2`
  and 7.1-dev**.
  - `effect-tsgo diagnostics --project <tsconfig>` ran **all three packages in
    about 12s**, with the same findings as the TS-5 service.
  - `effect-tsgo patch` patches the `typescript@7` `tsc` binary, so the
    diagnostics then show up in the normal typecheck and in the editor.
  - `typescript@7.0.2` `tsc` typechecks core and local with 0 errors. That
    matches the pinned tsgo.
- **Oxlint type-aware (`--type-aware` + `oxlint-tsgolint` 7.0.2003)** is
  stable. 60 rules ported from typescript-eslint. All the rules below ran in
  **5s**.
  - It has no Effect awareness. `no-floating-promises` ignores Effects, which
    are not thenables, so `floatingEffect` covers them.
  - `effect-tsgo patch --oxlint` adds `effecttsgo/*` rules to oxlint, but pins
    oxlint to 1.82–1.86.
- **ESLint:** `@effect/eslint-plugin` 0.3.2 has had no release since 2025-04.
  Its only rules are `dprint` and a barrel-import rule, and neither is
  type-aware. No maintained community plugin exists. Oxlint `jsPlugins` are
  alpha and syntax-only.

## Findings

Hits are counted across core, local and remote. "Test" is the share of hits in
test files.

| Rule                                                                                                     | Tool        | Catches                                                               | Hits (test)                 | Cost                          | Recommendation                                    |
| -------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- | --------------------------- | ----------------------------- | ------------------------------------------------- |
| floatingEffect                                                                                           | effect-tsgo | Effect built and dropped, never run                                   | **0**                       | none                          | **Error now**                                     |
| missingStarInYieldEffectGen                                                                              | effect-tsgo | `yield eff` without `*`                                               | **0**                       | none                          | **Error now**                                     |
| runEffectInsideEffect                                                                                    | effect-tsgo | `Effect.run*` inside a gen                                            | **0**                       | none                          | **Error now**                                     |
| returnEffectInGen / effectInVoidSuccess / effectInFailure / unknownInEffectCatch                         | effect-tsgo | Effect-of-Effect, an Effect lost in `void` or `E`, an `unknown` catch | **0**                       | none                          | **Error now**                                     |
| await-thenable                                                                                           | oxlint TA   | `await` on a non-promise                                              | **0**                       | none                          | **Error now**                                     |
| missingReturnYieldStar                                                                                   | effect-tsgo | `yield* fail` without `return` (default is error)                     | 7 (0) / 5 files             | small                         | Fix, then error                                   |
| catchUnfailableEffect                                                                                    | effect-tsgo | dead `catch*` on an Effect that never fails                           | 3 (0)                       | small                         | Fix, then error                                   |
| tryCatchInEffectGen                                                                                      | effect-tsgo | `try/catch` inside `Effect.gen`                                       | 3 (0)                       | small                         | Fix, then error                                   |
| globalErrorInEffectFailure / Catch                                                                       | effect-tsgo | untagged `Error` in `E`                                               | 14 (9)                      | small                         | Fix, then error. Encodes "type-safe errors"       |
| schemaSyncInEffect                                                                                       | effect-tsgo | `decodeUnknownSync` inside a gen                                      | 1                           | trivial                       | Fix, then error                                   |
| switch-exhaustiveness-check                                                                              | oxlint TA   | a union case with no branch                                           | 7 (0)                       | small                         | Fix, then error                                   |
| only-throw-error                                                                                         | oxlint TA   | throwing a non-Error                                                  | 7 (0)                       | small                         | Fix, then error                                   |
| no-floating-promises                                                                                     | oxlint TA   | unawaited promise                                                     | **139 (0) / 70 files**      | medium, mostly React handlers | Warn now. Ratchet per file                        |
| no-misused-promises                                                                                      | oxlint TA   | async fn where void is expected                                       | 99 (0) / 58 files           | medium                        | Warn now. Ratchet                                 |
| leakingRequirements                                                                                      | effect-tsgo | service methods that leak `CommandExecutor`                           | 2                           | design                        | Warn, then fix in ffmpeg services                 |
| anyUnknownInErrorContext / unsafeEffectTypeAssertion                                                     | effect-tsgo | `any`/`unknown` in E or R, Effect casts                               | 65 (51) / 6 (6)             | medium                        | Warn. Feeds "every `any` is a leak"               |
| Effect.run* outside boundary files                                                                       | grep guard  | runtimes escaping their edge                                          | 15 / 12 files               | allowlist                     | **Custom guard**, shrink-only list                |
| `catchAll(() => succeed/void)`                                                                           | grep guard  | errors swallowed silently                                             | 32 / 17 files               | review each                   | **Custom guard**, shrink-only list                |
| `Effect.promise(` in product code                                                                        | grep guard  | a rejection turned into a defect                                      | 48 / 11 files               | medium                        | **Custom guard** → `tryPromise`                   |
| missingEffectServiceDependency                                                                           | effect-tsgo | `DrizzleService` missing from `dependencies`                          | 24                          | n/a                           | Noise: provided at composition by design          |
| strictBooleanExpressions (both tools)                                                                    | both        | non-boolean conditions                                                | 3580 / 709                  | huge                          | Not doing                                         |
| asyncFunction, strictEffectProvide, effect-native globals (Date/Console/fetch/process.env/node builtins) | effect-tsgo | style choices toward Effect-native code                               | 1888, 531, ~800             | huge, mostly tests            | Not doing                                         |
| no-unsafe-* family, no-unnecessary-type-assertion/condition                                              | oxlint TA   | `any` flow                                                            | 1502 (~70% tests), 227, 176 | large                         | Not doing now. Revisit once the `any` count falls |

`yield` without `*` and `Effect.orDie` turned out not to be problems: the
missing-star rule has 0 hits, and `Effect.orDie` appears once.

## Phased rollout

**Phase 1 — 0-hit rules as errors (one PR, about 1 hour).**

> **Status (2026-10-06): shipped.** Steps 1 and 5 landed first (#1784): the
> coding standard and type-aware `await-thenable` as an error. Steps 2–4 then
> waited on TypeScript 7, because `effect-tsgo diagnostics` discovers an
> installed native `tsc` under the package name `typescript` and refused the
> old `@typescript/native-preview`. The follow-up PR (`chore/typescript-7`):
>
> - moves `typescript` to exactly `7.0.2` in every package except
>   `overlay-renderer`, which Remotion keeps on 5.8.2 and turbo already filters
>   out. `tsc` replaces `tsgo` in every `typecheck` script, and
>   `@typescript/native-preview` is gone.
> - adds `@effect/tsgo` 0.48.1 and a plugin block in the core, local and remote
>   `tsconfig.json`. `floatingEffect`, `missingStarInYieldEffectGen`,
>   `returnEffectInGen` and `runEffectInsideEffect` are errors, all at 0 hits.
>   The other rules that default to error are demoted to `warning`. The rest
>   keep their defaults and do not gate.
> - adds `lint:effect` (a turbo task, `dependsOn: ["^build"]`) after `typecheck`
>   in `pnpm run check` and in pre-commit. It costs about 13s.
>
> Step 3 differs from the plan: the ratchet rules are not yet set to `warning`.
> Only `--severity error` gates. Two caveats came out of the move:
>
> - dependency-cruiser 18.x only supports `typescript` <7, because it uses the
>   TS 5 JS API, which TS 7 no longer ships. A `pnpm.packageExtensions` entry
>   gives it its own `typescript@5.9.3`.
> - Vercel builds `apps/remote` with the project's `typescript`. Against TS 7,
>   `@vercel/node` ≥15 takes its native-compiler path (`tsc` binary) and no
>   longer uses `transpileModule`.
>
> The "Fix, then error" rows (Phase 2) are next.

1. Add a short Effect section to `CODING_STANDARDS.md`: "an Effect is always
   yielded or returned, never dropped; never `Effect.run*` inside an Effect;
   errors in `E` are tagged." That makes the rules eligible to be errors under
   the advisory policy.
2. Add `@effect/tsgo` as a dev dependency.
3. Add a `"plugins": [{ "name": "@effect/language-service", "diagnosticSeverity": {...} }]`
   block to each package `tsconfig.json`. Set the Phase-1 rules to `error`, the
   ratchet rules to `warning`, and every rule marked "not doing" to `off`.
4. Add a turbo task `lint:effect` that runs
   `effect-tsgo diagnostics --project tsconfig.json --format github-actions` in
   each package, with `dependsOn: ["^build"]` because remote needs core built.
5. Add `--type-aware` to `oxlint`, with `oxlint-tsgolint`. Make
   `await-thenable` an error. `no-floating-promises` and `no-misused-promises`
   go in as `warn`, matching how `correctness` is handled today.

**Phase 2 — clean up, then promote (about 6 small PRs).** Work through the
"Fix, then error" rows, one rule per PR, and promote each rule as it reaches 0.

> **Status — effect-tsgo rules (2026-10-06): done.** All hits were in
> `apps/local`; core and remote had none. Every effect-tsgo "Fix, then error"
> row is now an error in all three `tsconfig.json`s, backed by the "Failures
> are handled in Effect, not around it" standard.
>
> - `missingReturnYieldStar` (7), `catchUnfailableEffect` (3),
>   `tryCatchInEffectGen` (3) and `schemaSyncInEffect` (1) landed together
>   (#1789). One `catchUnfailableEffect` hit was a real bug: the export's
>   best-effort stage-failure log used `catchAll`, which never sees the defect
>   a sync `appendFileSync` throws, so a full disk would have replaced the
>   export's own error. It is now `catchAllDefect`, with a test.
> - `globalErrorInEffectFailure` / `globalErrorInEffectCatch` (14, 9 in tests)
>   landed on their own. Product code fails with new tagged errors
>   (`AutofillNoValidChaptersError`, `WslPathConversionError`,
>   `RevealInExplorerError`) carrying the same messages; tests fail with real
>   tagged errors (`FFmpegError`) or local ones. Two hits are suppressed with a
>   reason: the Clip Mockup daemon's `throw` inside a plain async HTTP handler
>   (not an Effect failure), and one `route-action` test that pins the
>   untagged-error fallback on purpose.

The two promise rules ratchet per directory with `overrides`, for example once
`app/services/**` is clean.

> **Status — type-aware oxlint rules (2026-10-06):**
>
> - `switch-exhaustiveness-check`: **error.** Re-measured at 10, not 7: the
>   rule's default counts a `default` branch over a union as not exhaustive.
>   Every switch now names each member; no branch changed what it returns.
>   (#1788)
> - `only-throw-error`: **error.** 7 hits. Two threw non-Errors (the
>   transaction rollback signal in `with-db-transaction` and `.sandcastle`'s
>   retry wrapper); both now throw an `Error`. The other five are React
>   Router's `throw data(..., { status })`, which is allowed by type
>   (`DataWithResponseInit`), because rewriting it would change the responses.
>   (#1790)
> - `no-floating-promises` / `no-misused-promises`: **warn, ratcheting.**
>   Re-measured at 139 / 99, which matches the table. They were already nearly
>   absent outside the React UI: 3 hits, all fixed with the semantics kept. A
>   daemon signal handler and a clip-service log line stay fire-and-forget,
>   now as `void` with a reason. A `.sandcastle` semaphore drops a comma
>   expression that tripped the rule. They are **errors** in
>   `apps/local/app/services/**`, `apps/local/app/cli/**`,
>   `apps/local/app/routes/**/*.ts`, `apps/remote/**`, `packages/**`,
>   `.sandcastle/**` and `scripts/**`. They stay warnings elsewhere: 138 / 97,
>   almost all in `features/`, `components/`, `hooks/` and `.tsx` routes,
>   mostly React event handlers. Each of those needs a judgement on whether
>   the handler should await, so that work is left for a per-directory pass
>   rather than a mass `void`.
> - **Per-directory pass 1 (2026-10-13): `features/jobs/**` promoted.** Its
>   one hit was the YouTube upload toast's "Copy YouTube Studio Link" button,
>   which handed the `writeText` promise to sonner's void `onClick`. It now
>   `.catch`es and says "Failed to copy YouTube Studio link", the same
>   handled-in-the-handler shape as `toast.tsx`'s Copy button, with a test.
>   Re-measured: 113 / 80 warnings (193). Next smallest: `features/pitches`
>   1, `features/publish` 1, `hooks` 3 (`features/animatic` 3 too).
> - **Per-directory pass 2 (2026-10-27): every directory at 5 or fewer
>   promoted.** Re-measured on main at 167 (101 floating / 66 misused); the
>   193 above was oxlint's whole warning count, not just these two rules.
>   Fixed and promoted: `features/pitches` 1, `features/publish` 2,
>   `features/animatic` 3, `hooks` 3, `features/lesson-writer` 4,
>   `features/article-writer` 5, `features/deliverables-calendar` 5,
>   `apps/local/chrome-extension` 2, `apps/local/scripts` 1, and the loose
>   files `app/root.tsx` 1 and `apps/local/playground.ts` 1. No `void`: each
>   fetcher, revalidate or navigate promise `.catch`es with a toast saying
>   what failed, the `job-toasts.ts` shape. The writer's Copy and Paste
>   buttons now go through `article-writer/clipboard.ts`, which toasts a
>   denied clipboard (Paste used to swallow it; Copy used to show "Copied"
>   regardless), with a test. Async handlers given to `onClick`,
>   `createServer` and Chrome's listeners became sync functions that handle
>   their own rejection. The override is now inverted: the two rules are
>   errors at the root and `overrides` lists only the backlog, at warn, so a
>   new directory starts clean. Remaining, smallest first:
>   `features/course-view` 9, `features/video-editor` 11,
>   `features/diagrams` 12, `components` 19, `features/video-posting` 22,
>   `.tsx` routes 66 (139).
> - **Per-directory pass 3 (2026-11-10): every directory at 12 or fewer
>   promoted.** Re-measured on main at 124: `features/course-view` 8,
>   `features/video-editor` 10, `features/diagrams` 11, `components` 16,
>   `features/video-posting` 22, `.tsx` routes 57. Fixed and promoted the
>   first three (29 hits). Fetcher submits and loads, revalidates and
>   navigates `.catch` with a toast saying what failed; on the Diagram
>   Playground, where toasts are off, the same message goes to the status
>   line (`usePlaygroundStatus` or the reducer's `error-reported`). The
>   rename field `EditableDiagramName` now takes a required `onRenameError`:
>   the rail passes the status line; Playground Home, which has neither a
>   status line nor toasts, logs it. Async click handlers (the divergence
>   report's Copy, the autofill modal's Confirm, the timeline's Copy and
>   Archive) became sync functions that handle their own rejection; a failed
>   autofill Confirm now toasts and leaves the modal open instead of an
>   unhandled rejection. The editor menu's Copy transcript and Copy YouTube
>   chapters dropped their `void` and toast a denied clipboard. A clip's
>   `play()` ignores the AbortError a pause causes and logs anything else,
>   as `footage-layers-preview.tsx` already did. Fetches that already
>   resolve to a fallback (`fetchSnapshotList`, `fetchMeta`, the
>   suggestions' Script) take the same fallback on a rejection. Remaining:
>   `components` 16, `features/video-posting` 22, `.tsx` routes 57 (95).

**Phase 3 — custom guards.** Add `scripts/check-effect-boundaries.sh` in the
style of the existing guards.

- It flags `Effect.run*` outside an allowlist: `route-action.server.ts`,
  `layer.server.ts`, `cli/`, `*-test-setup.ts`, the daemon entry points and
  `with-db-transaction`.
- It also flags new `catchAll(() => Effect.succeed|void)` and `Effect.promise(`
  in non-test code, each against a **shrink-only** legacy list, the same way
  `.oxlintrc.json` handles localStorage.

> **Status (2026-10-06): guards shipped.** `scripts/check-effect-guards.ts`
> instead of a grep script. It parses each file with `oxc-parser` (0.6s for
> the repo), because the swallowed catches often span lines and a grep would
> also count comments. No effect-tsgo rule covers any of the three patterns,
> and an oxlint JS plugin is still alpha. Node runs the `.ts` file directly
> (type stripping). It runs in `pnpm run check` with `--all`, so in CI, and on
> staged files in pre-commit. The allowlist, `scripts/effect-guards-allowlist.json`,
> is a count per file with a one-line reason. It fails on a new hit and on a
> stale entry. Test code is out of scope. The standard is "Effects stay
> inside their boundary" in `CODING_STANDARDS.md`.
>
> - **`effect-run`.** The plan's 15 counted only `Effect.run*`. The guard also
>   counts `runtime.run*`, which puts the real number at **30 in 27 files**.
>   The boundaries are not in the allowlist: `layer.server.ts`,
>   `route-action.server.ts`, `create-sse-response.server.ts`, `cli/`, the
>   Clip Mockup daemon's `server.ts`, `with-db-transaction` and the remote
>   app's `rpc.ts`/`auth.ts`. Eight routes ran `runtimeLive` by hand with the
>   same error handling `makeLoader`/`makeAction` gives, and moved onto them. The clip-service
>   per-video mutex is now an Effect semaphore, so `append-from-obs` no longer
>   leaves its run. The daemon client's semaphore uses
>   `Effect.unsafeMakeSemaphore`. The test-only `createDirectClipService`
>   moved to `test-utils/`. **30 → 19 hits (17 files)**, each with a reason:
>   deferred loader data, OAuth redirects, Promise adapters into the
>   clip-service handler, and hand-rolled pipelines whose 404 text differs
>   from `makeAction`'s.
> - **`swallowed-catch`.** The plan's 32 measured **35 in 20 files**, because
>   the guard also counts `catchAllCause` and block-bodied handlers. 19 were
>   best-effort `fs.remove` of a temp or replaced file. They now go through
>   `removeBestEffort`, which stays silent on `NotFound` and logs any other
>   failure as a warning instead of dropping it. **35 → 16 hits (11 files)**,
>   each with a reason: UI status probes whose fallback is the safe default,
>   cache sidecars where unreadable means a miss, FFmpeg's per-chunk drain
>   handlers, and the Dropbox-token check that must reach its "refuse" branch.
> - **`effect-promise`.** Measured at **45 in 9 files**. The plan's 48 also
>   counted `test-utils/`, which the guard treats as test code. One went with
>   the clip-service mutex in the `effect-run` PR. The clip-service handler's
>   36 raw Drizzle calls now go through `dbCall` (`tryPromise` →
>   `UnknownDBServiceError`). Autofill's two transactional writes do the
>   same. OBS clip detection fails with `ObsClipDetectionError`. The Document
>   Writer's model call fails with `WriterStreamError`. **44 → 5 hits**, each
>   with a reason: three `acquireRelease` file-handle closes, a finalizer that
>   cannot reject, and an in-memory `File.arrayBuffer()`.
>   **Behaviour change:** a rejected query or OBS detection in the clip
>   service is now a typed failure, not a defect. It rolls the transaction
>   back as before, `catchAll` can see it, and `makeAction` answers 500 as
>   before. `clip-service-handler.failures.test.ts` pins this.

**Phase 4 (optional) — one checker instead of two.** Replace
`@typescript/native-preview` with `typescript@7.0.2` and run
`effect-tsgo patch` in `prepare`. `tsc` then reports Effect diagnostics during
`typecheck` and in the editor, and `lint:effect` can be removed.

> **Status (2026-10-07): shipped.** The first half was already done by the
> Phase 1 move to `typescript@7.0.2`. This PR does the rest:
>
> - The root `prepare` script runs `scripts/patch-tsc.sh` after `husky`, which
>   runs `effect-tsgo patch --typescript`. The patch renames the native binary
>   to `tsc.original` and copies Effect's build in, so the shared pnpm store
>   is never written to, and a second run is a no-op. It is skipped when
>   `VERCEL` is set, so the `apps/remote` deploy compiles with stock `tsc` as
>   before.
> - `lint:effect` is gone: the three package scripts, the turbo task, the
>   `check:static` step and the pre-commit line. `typecheck` now reports the
>   same errors in one program build instead of two.
> - Each package's plugin block sets `ignoreEffectWarningsInTscExitCode: true`
>   and `includeSuggestionsInTsc: false`. The gate is unchanged: only rules at
>   `error` fail, as `--severity error` did. The 14 warnings
>   (`multipleEffectProvide` 12, `layerMergeAllWithDependencies` 2, all in
>   tests) now print in the `typecheck` output, as an invitation.
> - **Guard:** `scripts/check-effect-tsc.ts` (`check:effect-tsc`, first in
>   `check:static` and in pre-commit) runs core's `tsc` on
>   `packages/core/.effect-tsc-canary`, one deliberate `floatingEffect`, and
>   fails unless `tsc` reports it. It also fails if core, local and remote
>   resolve different `typescript` installs. Without it, a skipped patch
>   (`--ignore-scripts`, a restored `node_modules`, a `typescript` bump with
>   no matching `@effect/tsgo` build) would leave `tsc` exiting 0 while the
>   Effect rules silently stopped gating.
>
> Deferred: editor wiring. The patched `tsc` is what the workspace resolves,
> but whether an editor's TS 7 language server uses it depends on that
> editor's settings; the repo has no `.vscode/settings.json` and this PR does
> not add one. No Phase 5 is planned.

## CI and pre-commit

- **`pnpm run check`:** effect-tsc canary → typecheck (with the Effect
  rules, since Phase 4) → oxlint `--type-aware` → boundaries → guards →
  tests.
- **Pre-commit:** the effect-tsc canary and `typecheck`, which carries the
  Effect rules since Phase 4. The Phase-3 guard runs in staged mode. Type-aware oxlint stays
  CI-only, which matches the split `check:response-body` already uses.
- **Policy:** only rules backed by a standard (Phase 1 now, Phase 2 as each
  reaches 0) are `error`. Everything else is `warning`, an invitation, as
  `CLAUDE.md` says. A false positive gets
  `// @effect-diagnostics-next-line <rule>:off` with a reason.

## Risks

- **TypeScript version lockstep.** `@effect/tsgo` supports exactly 7.0.2 and
  7.1-dev, and its `--oxlint` patch pins oxlint to 1.86 or lower. Upgrades of
  typescript, oxlint and `@effect/tsgo` must move together. Pin them exactly,
  not with `^`.
- **Separate pass versus patch.** Phase 1 runs a separate diagnostics pass, so
  tsgo stays the typechecker. It costs two program builds but has no patching
  fragility. Phase 4 trades that for a patched `tsc`.
- **Effect 4** is out (4.0.1, 2026-10-05), and rule names and defaults are
  v4-first. A v4 migration means re-measuring this table.
- **0.x churn.** Both `@effect/tsgo` and the diagnostics' JSON shape can change
  between minor versions.

## Not doing

- No ESLint and no `@effect/eslint-plugin`. It has no type-aware rules, and
  `effect-tsgo` plus `tsgolint` cover everything ESLint would add.
- No `effecttsgo/*` oxlint plugin yet, because of the oxlint version pin. The
  same rules run via `diagnostics`.
- No Effect-native rules (globalDate, globalConsole, processEnv, asyncFunction,
  nodeBuiltinImport) and no `strictBooleanExpressions` or `strictEffectProvide`.
  That is about 7000 hits of style.
- No `no-unsafe-*` family until the `any` count falls.
- No custom oxlint JS plugin for Effect. It is alpha and syntax-only, and the
  grep guards are enough.
- No change to `missingEffectServiceDependency`: providing `DrizzleService` at
  composition is the design.
