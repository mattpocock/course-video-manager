---
name: deploy-migration
description: Ship a Drizzle schema change end to end — generate the migration, merge, migrate production through the backup-first `pnpm db:migrate:prod`, redeploy apps/remote, confirm it is green. Also how to renumber a migration when two branches picked the same number. Use whenever a change adds or edits a file under packages/core/db/migrations/ or changes packages/core/db/schema.ts, or when an apps/remote deploy failed with "production has not applied".
---

# Deploy a migration

Production is migrated **only through `pnpm db:migrate:prod`** (#2653). It takes a PlanetScale backup, waits until the backup is ready, prints its ID and a restore hint, and only then runs the migrate. If any step fails, it stops and migrates nothing. `apps/remote` deploys on every merge, and its build (`apps/remote/scripts/assert-migrations-applied.mjs`) fails on purpose when production lacks the commit's latest migration, so the previous deployment keeps serving. You merge, production is migrated, then you redeploy.

**Never run `pnpm db:migrate` (or `drizzle-kit migrate`/`push`) against production**, and never write to production by any other route. `db:migrate:prod` has no skip flag and no fallback. If it fails, you stop. `packages/core/drizzle-guard.ts` refuses most wrong runs, but don't rely on it.

## 1. Generate and merge

1. Change `packages/core/db/schema.ts`, then run `pnpm db:generate`. Commit the generated SQL and the `meta/` files unedited.
2. The migration and the code that uses it may ship in **one PR**. It must be additive: a new table, a nullable column, or a column with a default. For anything destructive, see section 4.
3. Land it the usual way (`docs/agents/merging.md`).

## 2. The deploy fails, then production is migrated

The `apps/remote` deploy for the merge commit fails with `production has not applied <tag>`. That failure is expected and harmless: the old deployment is still serving.

Migrate from Matt's **main checkout**, never from a worktree. The command refuses unless the checkout is a clean `main` at exactly `origin/main`. If the main checkout is not already a clean `main`, stop and tell Matt. Do not switch his branch for him.

```
cd ~/repos/matt/course-video-manager && git pull --ff-only && pnpm db:migrate:prod
```

- **It prints `Backup ready: <id>` before it migrates.** Quote the backup ID and the migration tag in your report and on the PR.
- **If it exits non-zero, stop.** Do not retry, edit the command, or reach for `pnpm db:migrate`. Report its last lines to Matt. A failure before `Backup ready` means nothing was migrated. A failure after it means the backup is intact and the migrate itself failed.
- Never restore a backup. Restoring is Matt's job: it lands on a new branch and the app has to be repointed by hand.

The command reads the PlanetScale service token from `~/.config/cvm/planetscale-backup-token`. Never open, print or copy that file. If it is missing or refused, tell Matt.

## 3. Redeploy and confirm

1. Find the failed deployment for the merge commit:

   ```
   npx vercel@latest ls course-video-manager-remote --scope matt-pococks-projects -m githubCommitSha=<merge-sha> --json
   ```

   Take the `url` of the `production` deployment whose `state` is `ERROR`.

2. Rebuild it. The CLI is already logged in on Matt's machine. The command waits for the build and prints `Ready` on success.

   ```
   npx vercel@latest redeploy <url> --scope matt-pococks-projects
   ```

   If the build fails again with `production has not applied`, the migrate did not take. Tell Matt, quoting the tag. Do not redeploy in a loop.

   `redeploy` of the merge commit's deployment is the **only** way you put anything on production. Never run `vercel deploy --prod` (or `vercel --prod`): it uploads your working tree, not `main`. The build refuses it anyway (`apps/remote/scripts/assert-production-source.mjs` fails any production build that is not a GitHub clone of `main`), but don't rely on that. If `redeploy` fails with `assert-production-source`, you redeployed the wrong deployment: stop and tell Matt.

3. Confirm on GitHub. Read the commit's status contexts and check that `Vercel` is `SUCCESS` with a `createdAt` after your redeploy:

   ```
   gh api graphql -f query='{repository(owner:"mattpocock",name:"course-video-manager"){object(expression:"<merge-sha>"){... on Commit{status{contexts{context state description targetUrl createdAt}}}}}}'
   ```

   Use GraphQL. The REST `commits/<sha>/statuses` endpoint has returned HTTP 500 for this repo.

   A `vercel redeploy` posts a fresh `Vercel` status to the commit, so this check is enough on its own. This was confirmed on 2026-10-26: redeploying `9b13531b` posted `Vercel` = `SUCCESS`. If the status never appears, report the `Ready` line and the URL that `vercel redeploy` printed instead.

## 4. Destructive changes go contract-first

Dropping or renaming a column or table, or making a column `NOT NULL` without a default, would break the code already serving. Run it in two PRs:

1. **Stop using it.** Remove the column from `schema.ts` and every read and write of it. Merge, and let `apps/remote` deploy green.
2. **Drop it.** Only then generate and merge the migration that drops it, and follow sections 2 and 3.

A rename is add-new → copy the data → switch the code → drop-old, with each step shipped as above.

## 5. Two branches picked the same migration number

Two open PRs can both generate `00NN`. The one that merges first keeps the number. The other renumbers before it merges, and never after its migration has run anywhere but a local or test database.

A migration is three things, and all three must move together:

- `packages/core/db/migrations/00NN_<name>.sql`
- `meta/00NN_snapshot.json`, whose `prevId` must equal the `id` of the previous snapshot
- its entry in `meta/_journal.json` (`idx`, `tag`, `when`)

Drizzle applies only the journal entries whose `when` is later than the newest one already applied. So an entry with an older `when` than `main`'s latest is **skipped forever** in production (PR #1836). Renaming the files by hand is how that happens. Regenerate instead:

1. Merge `origin/main` into your branch (never rebase). Resolve `_journal.json` by taking `main`'s version.
2. Delete your `00NN_<name>.sql` and your `meta/00NN_snapshot.json`, then restore `main`'s files of that number (`git checkout origin/main -- packages/core/db/migrations`).
3. Run `pnpm db:generate`. It writes your change again as the next number, with a fresh `when` and a snapshot chained off `main`'s.
4. If your old migration had hand-written SQL (a backfill, say), copy that SQL into the new file. Nothing else in it should differ.
5. Check it: the journal's last two `idx` values run on in order, the new `when` is the largest, the new snapshot's `prevId` equals `main`'s latest snapshot `id`, and `git diff origin/main -- packages/core/db/migrations` shows only your new files plus one appended journal entry. Then run the targeted migration tests (`migrations.test.ts`).

## Matt's one-time PlanetScale setup

`db:migrate:prod` needs these, and only Matt sets them up:

- Backups: daily, kept 30 days.
- Deletion protection on the database and on its production branch.
- A service token with only `read_backups` and `write_backups` on the CVM database, stored as one line `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>` in `~/.config/cvm/planetscale-backup-token`, `chmod 600`.
- The organization, database and branch names in `apps/local/scripts/planetscale-target.json` must be correct.

The nightly off-PlanetScale copy is `pnpm db:dump`. It writes to `~/backups/cvm/` and keeps 14 dumps. `pnpm db:dump --cron-line` prints the crontab line. Matt installs it. Agents never install a cron or timer.

## Local development

On Matt's machine, `apps/local` uses the production database too. `pnpm dev` and `pnpm start` print a loud warning when that database is behind the checkout's migrations (`apps/local/scripts/warn-pending-migrations.ts`). The fix is the same command from section 2.
