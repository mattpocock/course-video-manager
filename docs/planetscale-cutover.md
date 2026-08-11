# Moving the domain database to PlanetScale

The runbook for issue #1536's first step. Everything here is done by hand
against real infrastructure; the code side of it is already merged.

Each step is reversible until the last, and the local Postgres container stays
alongside for at least a week — reverting is one environment variable.

`scripts/cutover-wizard.sh` walks the whole of it — this database move, then the
`apps/remote` deploy and the first API token — opening each page, running each
command and writing each value into `.env` as it goes. This document stays the
account of WHY each step is what it is; the script is the account of what to do
next. Run it from the repository root:

```sh
./scripts/cutover-wizard.sh
```

## Connection strings

Two, not one:

| Variable              | Points at              | Used by                             |
| --------------------- | ---------------------- | ----------------------------------- |
| `DATABASE_URL`        | the pooler (PgBouncer) | every application query             |
| `DIRECT_DATABASE_URL` | the primary            | the deploy's migrate step,          |
|                       |                        | `db:baseline`, `db:verify-features` |

A transaction-mode pooler cannot carry session-level DDL state, so migrations
must bypass it. `DIRECT_DATABASE_URL` is optional and falls back to
`DATABASE_URL` — a local container has no pooler, so it stays unset there
(`packages/core/db/database-url.ts`).

## Steps

1. **Create the database.** PS-5, London. Configure a **daily** backup schedule
   retained 30 days. Daily, not weekly: a weekly schedule means replaying up to
   seven days of WAL on restore, which takes hours.

2. **Run the migrations** against the new branch with `DIRECT_DATABASE_URL` set.
   This is the one time they are applied by hand — from here on it is the
   `apps/remote` deploy's `vercel-build` step and nothing else:

   ```sh
   pnpm --filter @cvm/core run db:migrate
   ```

3. **Verify the risky schema features by hand.** PlanetScale documents
   `tsvector` and `jsonb` as supported and says nothing about `COLLATE "C"`,
   generated `STORED` columns, GIN indexes, partial unique indexes or `text[]`
   — all of which this schema uses for Diagram search and Fractional Index
   ordering. PGlite cannot prove hosted compatibility, so this runs against the
   real branch:

   ```sh
   pnpm run db:verify-features
   ```

   It prints PASS/FAIL per feature and exits non-zero on any failure. Paste the
   output onto issue #1537. Do not cut over on a FAIL.

4. **Dump and restore the data.** ~81 MB total, so under a minute. Exclude the
   third-party auth tables (`youtube_auth`, `ai_hero_auth`) if you would rather
   re-authenticate than move credentials.

5. **Point `apps/local` at it** by swapping `DATABASE_URL`, keeping the local
   container's connection string commented alongside. Use it normally for a
   week and measure route loader latency (the browser's network panel on the
   Course view is enough). Record the numbers on issue #1537.

   If latency proves bad, the fix is batching inside the operations services,
   not reversing the plan.

6. **Retire nothing yet.** The local container stays until the hosted database
   has carried a week of real use.

## What went away

`dump-service.ts`, `backup-coordinator.ts`, the `/api/backup/*` routes and the
`PG_DUMP_CONTAINER` / `DUMP_FILE_LOCATION` / `CVM_SERVER_URL` configuration are
deleted. The hosted point-in-time recovery replaces them.

This is a real trade. The coordinator refused every CLI write unless a fresh
dump could be taken, which made an agent write un-losable. That is exchanged
for a 30-day recovery window with a restore measured in about an hour — and it
is given up at exactly the moment an agent starts writing from a machine nobody
is watching.

One consequence worth naming: `cvm` writes no longer require the dev server to
be running.
