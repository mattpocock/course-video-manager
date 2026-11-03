---
name: deploy-migration
description: Ship a Drizzle schema change end to end — generate the migration, open the PR, hand it to Matt to merge (merging runs it: the apps/remote production build backs production up and migrates), then confirm the deploy is green. Also how to renumber a migration when two branches picked the same number, and the break-glass `pnpm db:migrate:prod`. Use whenever a change adds or edits a file under packages/core/db/migrations/ or changes packages/core/db/schema.ts, or when an apps/remote deploy failed with "production has not applied" or "migrate-on-deploy".
---

# Deploy a migration

**Merging a migration PR to `main` runs it** (#2655). The `apps/remote` production build (`apps/remote/scripts/migrate-on-deploy.mjs`, logic in `packages/core/db/migrate-on-deploy.ts`) takes a PlanetScale backup, waits until it is ready, prints its ID and a restore hint, then migrates under a Postgres advisory lock. If nothing is pending it does nothing. If any step fails the build fails, nothing more is migrated, and the previous deployment keeps serving. Preview builds never migrate.

So **agents never merge a PR that adds or edits a migration, and never queue auto-merge on one.** Matt merges it. This holds even when `check` is green and the PR is otherwise ready.

**Never run `pnpm db:migrate` (or `drizzle-kit migrate`/`push`) against production**, and never write to production by any other route. `packages/core/drizzle-guard.ts` refuses most wrong runs, but don't rely on it.

## 1. Generate and open the PR

1. Change `packages/core/db/schema.ts`, then run `pnpm db:generate`. Commit the generated SQL and the `meta/` files unedited.
2. The migration must be **safe for the previous code** (section 4): the old deployment keeps serving while the build migrates, and Matt's local CVM runs against production on whatever checkout it has. Additive is safe: a new table, a nullable column, a column with a default. The migration and the code that uses it may then ship in one PR.
3. Open the PR the usual way (`docs/agents/merging.md`), wait for `check`, and stop. In the PR body, say it carries a migration and that Matt merges it. Do not run `gh pr merge` in any form.

## 2. After Matt merges: confirm the deploy

The production build for the merge commit migrates. Read its outcome on GitHub:

```
gh api graphql -f query='{repository(owner:"mattpocock",name:"course-video-manager"){object(expression:"<merge-sha>"){... on Commit{status{contexts{context state description targetUrl createdAt}}}}}}'
```

Use GraphQL. The REST `commits/<sha>/statuses` endpoint has returned HTTP 500 for this repo.

- `Vercel` = `SUCCESS`: migrated (or nothing was pending) and deployed. The build log's `Backup ready: <id>` line is the pre-migration backup; quote it if you can see it.
- `Vercel` = `FAILURE`: the old deployment is still serving. Report the state and `targetUrl` to Matt and stop. Do not redeploy, retry or migrate by hand. The log says which it was: `… pending, but DIRECT_DATABASE_URL / PLANETSCALE_BACKUP_TOKEN is not set` (Matt adds it in Vercel), a backup failure before `Backup ready` (nothing was migrated), or a migrate failure after it (the backup is intact).

Never restore a backup. Restoring is Matt's job: it lands on a new branch and the app has to be repointed by hand.

## 3. Redeploying (only when Matt asks)

Once Matt has fixed what failed, he may ask you to rebuild the failed deployment. A redeploy runs the same build, so it migrates if anything is still pending.

1. Find the failed deployment for the merge commit:

   ```
   npx vercel@latest ls course-video-manager-remote --scope matt-pococks-projects -m githubCommitSha=<merge-sha> --json
   ```

   Take the `url` of the `production` deployment whose `state` is `ERROR`.

2. Rebuild it. The CLI is already logged in on Matt's machine. The command waits for the build and prints `Ready` on success.

   ```
   npx vercel@latest redeploy <url> --scope matt-pococks-projects
   ```

   If it fails again, tell Matt, quoting the last lines. Do not redeploy in a loop.

   `redeploy` of the merge commit's deployment is the **only** way you put anything on production. Never run `vercel deploy --prod` (or `vercel --prod`): it uploads your working tree, not `main`. The build refuses it anyway (`apps/remote/scripts/assert-production-source.mjs` fails any production build that is not a GitHub clone of `main`), but don't rely on that. If `redeploy` fails with `assert-production-source`, you redeployed the wrong deployment: stop and tell Matt.

3. Confirm with the GraphQL query in section 2. A `vercel redeploy` posts a fresh `Vercel` status to the commit; check its `createdAt` is after your redeploy.

## 4. Safe for the previous code: destructive changes go contract-first

Dropping or renaming a column or table, or making a column `NOT NULL` without a default, would break the code already serving and Matt's local CVM. Run it in two PRs:

1. **Stop using it.** Remove the column from `schema.ts` and every read and write of it. Merge, and let `apps/remote` deploy green.
2. **Drop it.** Only once no deployed or local code reads it, generate the migration that drops it. Matt merges it, and that runs it.

A rename is add-new → copy the data → switch the code → drop-old, with each step shipped as above.

Worked example: #2648 (`0050`) drops `overlay.footage_path` and `footage_start`. #2576 (PR #2593, merged 2026-11-02) already removed every read and write of them and is what `apps/remote` serves, so the DROPs break no deployment. Matt's local CVM is safe once its checkout is past PR #2593.

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

## Matt's one-time setup

Only Matt does these. Agents never set Vercel env vars and never call the Vercel or PlanetScale APIs.

- PlanetScale backups: daily, kept 30 days. Deletion protection on the database and on its production branch.
- A service token with only `read_backups` and `write_backups` on the CVM database.
- In the Vercel project `course-video-manager-remote`, **Production environment only**: `PLANETSCALE_BACKUP_TOKEN` = `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`, and `DIRECT_DATABASE_URL` = the primary (non-pooled) connection string. `DATABASE_URL` is already set. Both are needed only when a migration is pending, so a missing one fails only that build.
- For the break-glass path, the same token as one line in `~/.config/cvm/planetscale-backup-token`, `chmod 600`.
- The organization, database and branch names are `PRODUCTION_TARGET` in `packages/core/db/planetscale-backup.ts`.

## Break glass: `pnpm db:migrate:prod`

Matt's manual path, the same backup-then-migrate from his machine. It reads the token from `~/.config/cvm/planetscale-backup-token`. Never open, print or copy that file. It does not take the build's advisory lock, so it is never run while an `apps/remote` production build is running. Agents run it only when Matt asks, from his **main checkout** (never a worktree), which must be a clean `main` at exactly `origin/main`:

```
cd ~/repos/matt/course-video-manager && git pull --ff-only && pnpm db:migrate:prod
```

It prints `Backup ready: <id>` before it migrates. If it exits non-zero, stop and report its last lines; never fall back to `pnpm db:migrate`.

The nightly off-PlanetScale copy is `pnpm db:dump`. It writes to `~/backups/cvm/` and keeps 14 dumps. `pnpm db:dump --cron-line` prints the crontab line. Matt installs it. Agents never install a cron or timer.

## Local development

On Matt's machine, `apps/local` uses the production database too. `pnpm dev` and `pnpm start` print a loud warning when that database is behind the checkout's migrations (`apps/local/scripts/warn-pending-migrations.ts`). It means the checkout is ahead of production: the merge commit's deploy has not finished or has failed (section 2), or the checkout is on an unmerged branch. Never migrate to silence it.
