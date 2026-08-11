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

This supersedes the "there is deliberately no `pnpm db:migrate`" line in [ADR 0025](0025-local-remote-split-one-http-transport.md); the rest of that ADR — one HTTP transport, the version gate, token auth, local-only commands — is unaffected.
