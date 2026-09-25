# Testing: targeted locally, exhaustive in CI

Two tiers, on purpose — don't run a package's full suite (let alone the whole monorepo's) by hand while iterating.

## While iterating: run only the test file(s) your change touches

You already know which file(s) you edited and which test(s) cover them — a colocated `*.test.ts`, or whatever exercises the changed function/module. Run just those, through the owning package's vitest, not that package's whole `test` script:

```
pnpm --filter <package> test -- path/to/thing.test.ts
```

e.g. `pnpm --filter @cvm/core test -- db/lessons/archive.test.ts`. `pnpm --filter` forwards anything after `--` straight to the package's `vitest run`, so it narrows to that one file (or a handful, space-separated) instead of the whole package. Package names are each `package.json`'s `name` field (`@cvm/core`, `@cvm/local`, `@cvm/remote`, `@cvm/lucide-icons`).

Root-level `.sandcastle` tests are the one exception: run them via `pnpm run test:root path/to/thing.test.ts` — **no `--`**. At the repo root, `pnpm run <script> -- <args>` (unlike `pnpm --filter <pkg> <script> -- <args>`) forwards a literal `"--"` through to vitest along with your path, which silently runs the whole root suite instead of narrowing — confirmed on pnpm 9.12.3. Dropping the `--` narrows correctly.

This is deliberately manual rather than diff-derived — no `turbo --affected`, no vitest `--changed`, no heuristic guessing "what could this diff have broken" from git history. You already know what you touched and what covers it; that's a better signal than a git-diff heuristic, which can still widen out to a whole package (or more) on a broad-looking diff and cost you the time it was meant to save.

## The full suite: CI, not you

`.github/workflows/test.yml` runs `pnpm run check` on every PR — `typecheck`, `oxlint`, `lint:boundaries`, the four `scripts/` guards and the **unfiltered** `pnpm run test` — every package, every test file, every time. That's what makes it safe to stay targeted locally: nothing merges without the exhaustive run passing regardless of what you ran (or skipped) by hand. Reach for the full `pnpm run test` yourself only if you have a specific reason to distrust your own targeting for this change (e.g. you suspect a cross-package regression the test files you picked wouldn't catch).

## Known noise: `packages/core`'s PGlite suite can look flaky under load

`packages/core` runs its DB-backed tests over in-process PGlite with up to 5 parallel forks (ADR 0014). On a CPU-constrained box (a shared/sandboxed agent workspace, not CI) that can produce sporadic per-test timeouts in otherwise-unrelated files — a symptom of contention, not a regression. Before treating a failure as real:

1. Re-run just that file in isolation (`npx vitest run <file>` from `packages/core`, or `apps/local`) — if it passes alone, that's contention, not a bug.
2. If still unsure, `git stash` your changes and re-run the same file against `main` — if it fails identically there, it's pre-existing.

Do **not** chase this by re-running the full suite with `--no-file-parallelism`; serializing ~150+ test files can take 10+ minutes and gives no more signal than step 1.

## One build-order gotcha

`packages/core` is consumed via its built `dist/` (its `package.json` `exports` map points there), even from tests — `pnpm run test` builds it first automatically (Turbo's `dependsOn: ["^build"]`), but running `vitest` directly inside `apps/local` or `apps/remote` (bypassing Turbo for faster iteration) will fail to resolve `@cvm/core/...` imports unless you've run `pnpm --filter @cvm/core build` at least once first.
