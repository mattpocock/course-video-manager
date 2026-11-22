# Testing: targeted locally, exhaustive in CI

Two tiers, on purpose — don't run a package's full suite (let alone the whole monorepo's) by hand while iterating.

## While iterating: run only the test file(s) your change touches

You already know which file(s) you edited and which test(s) cover them — a colocated `*.test.ts`, or whatever exercises the changed function/module. Run just those, through the owning package's vitest, not that package's whole `test` script:

```
pnpm --filter <package> test -- path/to/thing.test.ts
```

e.g. `pnpm --filter @cvm/core test -- db/lessons/archive.test.ts`. `pnpm --filter` forwards anything after `--` straight to the package's `vitest run`, so it narrows to that one file (or a handful, space-separated) instead of the whole package. Package names are each `package.json`'s `name` field (`@cvm/core`, `@cvm/local`, `@cvm/remote`, `@cvm/lucide-icons`).

Component tests (`apps/local/**/*.browser.test.tsx`, real headless Chromium) have their own script: `pnpm --filter @cvm/local test:browser -- path/to/x.browser.test.tsx`. `docs/TESTING_STANDARDS.md` says when one is warranted (rarely).

Root-level `.sandcastle` tests are the one exception: run them via `pnpm run test:root path/to/thing.test.ts` — **no `--`**. At the repo root, `pnpm run <script> -- <args>` (unlike `pnpm --filter <pkg> <script> -- <args>`) forwards a literal `"--"` through to vitest along with your path, which silently runs the whole root suite instead of narrowing — confirmed on pnpm 9.12.3. Dropping the `--` narrows correctly.

This is deliberately manual rather than diff-derived — no `turbo --affected`, no vitest `--changed`, no heuristic guessing "what could this diff have broken" from git history. You already know what you touched and what covers it; that's a better signal than a git-diff heuristic, which can still widen out to a whole package (or more) on a broad-looking diff and cost you the time it was meant to save.

## The full suite: CI, not you

`.github/workflows/test.yml` runs everything `pnpm run check` runs on every PR (split into parallel jobs, with `@cvm/local`'s suite sharded four ways, all rolled up into the one required `check` context) — `typecheck`, `oxlint` (the lint ratchet and its canary), `lint:boundaries`, the file guards and the **unfiltered** `pnpm run test` — every package, every test file, every time. That's what makes it safe to stay targeted locally: nothing merges without the exhaustive run passing regardless of what you ran (or skipped) by hand. Reach for the full `pnpm run test` yourself only if you have a specific reason to distrust your own targeting for this change (e.g. you suspect a cross-package regression the test files you picked wouldn't catch).

## The test database: one Postgres container, a database per test file

Every DB-backed test (`createTestDb()` from `test-utils/test-db.ts`) gets a database of its own on one shared Postgres server (ADR 0046): the `cvm-test-postgres` Docker container, on `127.0.0.1:54329`, data on a tmpfs. The global setup starts it the first time (and whenever it is stopped), pushes the schema into a per-run TEMPLATE database, and every test file clones that with `CREATE DATABASE … TEMPLATE`. The file's databases are dropped when it finishes; a run's are dropped at teardown; a killed run's are swept by the next run.

- **Docker Desktop must be running** (with WSL integration on). Without it the run stops at once with `Docker is not running.` and what to do.
- Point the suite at another local server with `CVM_TEST_DATABASE_URL` (admin URL, database `postgres`). Only `127.0.0.1`, `localhost`, `::1` and `host.docker.internal` are accepted. Sandcastle sandboxes set it to the host's container.
- The container is safe to stop or remove at any time (`docker rm -f cvm-test-postgres`); the next run recreates it. Nothing else in Docker is touched.
- A test that passed on PGlite and fails here is usually an order the query never promised (`IN (…)` or a join without `ORDER BY`), or a race the in-process database used to win. Fix the query or the race, not the database.

## One build-order gotcha

`packages/core` is consumed via its built `dist/` (its `package.json` `exports` map points there), even from tests — `pnpm run test` builds it first automatically (Turbo's `dependsOn: ["^build"]`), but running `vitest` directly inside `apps/local` or `apps/remote` (bypassing Turbo for faster iteration) will fail to resolve `@cvm/core/...` imports unless you've run `pnpm --filter @cvm/core build` at least once first.
