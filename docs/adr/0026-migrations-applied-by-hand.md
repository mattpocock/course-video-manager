---
status: accepted
---

# Migrations are applied by hand, not by the remote deploy

ADR 0025 made the `apps/remote` deploy the only thing that runs `db:migrate`, specifically so two writers could never race to alter the production schema: "There is deliberately no `pnpm db:migrate`." In practice this meant `apps/remote/package.json`'s `vercel-build` script ran `db:migrate` against `DIRECT_DATABASE_URL` on _every_ Vercel build — not just a merge to `main`, but every preview deployment Vercel builds for an open PR. An unreviewed, unmerged branch could apply its migration to the production schema the moment Vercel built its preview, which is a worse failure mode than the one the rule was written to prevent.

## What changed

`vercel-build` no longer runs `db:migrate` — it only builds `@cvm/core` (see `apps/remote/README.md`). Applying migrations is now a manual step, run by hand with `pnpm db:migrate` (a new root script proxying to `packages/core`'s `db:migrate`, alongside `db:generate` and `db:studio`), against `DIRECT_DATABASE_URL`, whenever the author chooses to run it — typically right before deploying the code that depends on the new schema, the same way migrations were already applied by hand once, during the PlanetScale cutover (`docs/planetscale-cutover.md`).

## Why this still gives one writer

The "exactly one writer" guarantee ADR 0025 wanted was never really about the deploy _mechanically_ owning `db:migrate` — it was about avoiding two things applying schema changes at once. That's now a process guarantee instead of a mechanical one: only the author runs `pnpm db:migrate`, by hand, and no automated build does. It holds because the other half of ADR 0025's rule is untouched — **migrations stay additive-only**, so applying one ahead of the code that uses it is always safe (old code just ignores the new column), and a `cvm` invocation mid-flight is no more at risk than it was before.

## Consequence

A schema change now needs an explicit, remembered step. Forgetting to run `pnpm db:migrate` before deploying code that reads a new column fails loudly — the column doesn't exist — not silently, which is the same failure shape the version gate already watches for on the read side.

## Addendum: a remote migration runs only from `main` at origin/main

"Only the author runs it" was not enough. An unmerged branch (`fix/lint-exclude-archived-videos`) ran `db:migrate` against production; its `0004` carried a later timestamp than `main`'s real `0004`, and because Drizzle applies only migrations newer than the last one it recorded, it skipped `main`'s `0004` for months (PR #1836).

So the process guarantee is now mechanical again. `packages/core/drizzle.config.ts` — loaded by every drizzle-kit command — calls `drizzle-guard.ts` before `migrate` or `push`. When the target host is **not local** it refuses unless the current branch is `main`, the working tree is clean (untracked files count: an untracked migration is still applied), and `HEAD` equals `origin/main` after a fresh `git fetch`. It prints only the hostname, never the URL. Local targets — `localhost`, `127.x`, `::1`, `0.0.0.0`, `host.docker.internal`, `*.localhost`, a Unix socket — are never checked, so tests (PGlite, which never goes through drizzle-kit), verify clones and dev databases migrate as before. An unparseable URL counts as remote.

There is **no override flag**. Every legitimate remote migration, an emergency one included, can meet the rule: merge it, then `git switch main && git pull --ff-only && pnpm db:migrate` from the main checkout. That is also the only path on which the journal stays in order, and a typed confirmation is no barrier to the headless agents most likely to run the wrong branch.

This supersedes the "there is deliberately no `pnpm db:migrate`" line in [ADR 0025](0025-local-remote-split-one-http-transport.md); the rest of that ADR — one HTTP transport, the version gate, token auth, local-only commands — is unaffected.

## Addendum: the deploy refuses code that is ahead of production

"Applying one ahead of the code that uses it is always safe" held only if someone applied it ahead. PR #1859 merged migration 0028 in the same PR as code selecting the new column; `apps/remote` deployed on merge and read a column production did not have until Matt migrated.

So the deploy now checks. The `apps/remote` `vercel-build` runs a read-only `SELECT` on `drizzle.__drizzle_migrations` through the app's own `DATABASE_URL` and fails the build when the commit's latest journal entry is not applied. The deployment that would query missing schema is never promoted; the previous one keeps serving. Once Matt has migrated, the failed deployment is redeployed. The whole flow is the `deploy-migration` skill (`.claude/skills/deploy-migration/SKILL.md`).

PR #1861 also added a merge-side gate: migration-only PRs enforced in CI, plus a `migration-applied` label only Matt could add. It was removed: the deploy check alone prevents the breakage, and the gate doubled the PRs and hand-offs for every schema change. Destructive changes (drop, rename, `NOT NULL` without a default) still go contract-first, because the deploy check cannot protect code already running against a column that disappears.

`migrations.test.ts` checks that every column `schema.ts` declares is created by a migration, rather than that the two produce identical tables, because during a contract change the migrations are briefly ahead of the schema.

`apps/local` runs against production too, so `pnpm dev` and `pnpm start` first run `apps/local/scripts/warn-pending-migrations.ts`, which warns (never blocks) when the database is behind the checkout's migrations.

## Addendum: production is migrated only through a backup-first command

Production migrations now go through `pnpm db:migrate:prod` (`apps/local/scripts/migrate-production.ts`, #2653), and agents may run it. It checks the same rules as the drizzle guard. It takes an on-demand PlanetScale backup through the API, with a token holding only `read_backups` and `write_backups`. It waits for the backup to reach `success` and prints its ID. Only then does it run `pnpm db:migrate`. There is no skip flag and no fallback: no backup, no migrate. A bare `pnpm db:migrate` against production is still refused by nothing but convention, so the `deploy-migration` skill forbids it. Off-platform, `pnpm db:dump` keeps 14 nightly `pg_dump`s in `~/backups/cvm/`.
