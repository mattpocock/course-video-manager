## Agent skills

### Backlog

Issues and PRDs live as GitHub issues in `mattpocock/course-video-manager`, managed via the `gh` CLI. See `docs/agents/backlog.md`.

### Triage labels

Canonical defaults, except `ready-for-agent` is spelled `Sandcastle` in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### Repository layout

A Turborepo monorepo: `apps/local` is today's application, `apps/remote` is the deployed RPC API (a Hono app on Vercel — see [apps/remote/README.md](./apps/remote/README.md)), and `packages/core` is the domain database (the schema, the `DrizzleService` and every `db-*` service) and holds every piece of SQL. Neither `packages/core` nor `apps/remote` may import anything filesystem-bound — see their READMEs.

### Deep-module packages

Packages under `apps/local/app/packages/` are deep modules — import only through a package's entry points (its root files); everything in `lib/`/`tests/` is private. See [apps/local/app/packages/README.md](./apps/local/app/packages/README.md) before adding or importing one. `pnpm run lint:boundaries` enforces it (runs in pre-commit alongside `typecheck`), and the same command enforces that `packages/core` stays filesystem-free.

### cvm CLI

`cvm` is a read-mostly CLI (source in `apps/local/app/cli/`) that exposes this project's domain data to agents. It reaches that data over HTTP through `apps/remote`, authenticated with a bearer token (`CVM_API_URL` + `CVM_API_TOKEN`) — **there is one transport**, used by the author's invocations and an agent's alike; do not add an in-process fallback. Verb groups still wired directly to the database are listed in `apps/local/app/cli/layer.ts` and move to the API one group at a time. Most nouns are read-only; the write-capable ones are `beat` (add/update/move/delete), `lesson` (create/update/move), `video` (create/move/update), `file` (add/delete), `pitch` (create/update), `deliverable` (create/update/archive — the deadline surface, ADR 0022) and `course` (publish), each reusing its operations service's write methods. Writes are immediate (no confirmation/dry-run) and flags come before the positional `<id>`. More nouns may gain writes over time. Its `--help` text is a domain-teaching document written in ubiquitous-language terms drawn from `CONTEXT.md`. **Keep the cvm help text and `CONTEXT.md` in sync manually** — when domain vocabulary or entity fields change in `CONTEXT.md`, update the corresponding noun/verb help in `apps/local/app/cli/commands/*.ts` and the root help in `apps/local/app/cli/index.ts`.
