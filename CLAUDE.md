## Agent skills

### Backlog

Issues and PRDs live as GitHub issues in `mattpocock/course-video-manager`, managed via the `gh` CLI. See `docs/agents/backlog.md`.

### Triage labels

Canonical defaults, except `ready-for-agent` is spelled `Sandcastle` in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### Repository layout

A Turborepo monorepo. Two apps: `apps/local` is today's application, and `apps/remote` is the deployed RPC API (a Hono app on Vercel — see [apps/remote/README.md](./apps/remote/README.md)). Three workspace packages under `packages/`:

- `packages/core` — the domain database (the schema, the `DrizzleService`, every `db-*` service and `CourseWriteService`), and every piece of SQL in the repo. Also holds the pure domain logic both apps share, under `features/` (Clip Zoom, Overlay Kind, Bullet Panel, Overlay Transform); `apps/local` reaches those through one-off `@/features/videos/*` aliases in its tsconfig.
- `packages/lucide-icons` — the vendored, append-only lucide icon-node table, plus the tldraw path transpiler behind its own entry point. A top-level package because it has consumers on both sides of the repo: `apps/local` and `packages/overlay-renderer`.
- `packages/overlay-renderer` — the standalone Remotion renderer for Overlay content (Definition Cards, Bullet Panels) and the vertical Shorts overlay. `apps/local` shells out to its built `bin.mjs` rather than importing its render path, so it is EXCLUDED from every root turbo filter (`--filter=!@cvm/overlay-renderer`) and has its own `test`/`typecheck` scripts to run from its own directory.

Neither `packages/core` nor `apps/remote` may import anything filesystem-bound — see their READMEs.

### Deep-module packages

Packages under `apps/local/app/packages/` are deep modules — import only through a package's entry points (its root files); everything in `lib/`/`tests/` is private. See [apps/local/app/packages/README.md](./apps/local/app/packages/README.md) before adding or importing one. `packages/lucide-icons` is the same idea promoted to a workspace package: its entry points are `index.ts`, `generator.ts` and `tldraw.ts` (exactly its `exports` map), and it carries its own `.dependency-cruiser.cjs`. `pnpm run lint:boundaries` fans out to every package's own check (it runs in pre-commit alongside `typecheck`), so it enforces all of that plus `packages/core` staying filesystem-free.

### cvm CLI

`cvm` is a read-mostly CLI (source in `apps/local/app/cli/`) that exposes this project's domain data to agents. It reaches that data over HTTP through `apps/remote`, authenticated with a bearer token (`CVM_API_URL` + `CVM_API_TOKEN`) — **there is one transport**, used by the author's invocations and an agent's alike; do not add an in-process fallback. Every verb group goes through it, so `cvm` needs no `DATABASE_URL` (only `course publish`, which runs the publish pipeline in-process on the author's machine, still reads one). Every request states the **Schema Version** its checkout was built against and a mismatch is refused outright (exit 6) — migrations are applied by the `apps/remote` deploy alone, and are additive-only. Three commands are **local-only** and refuse on any other machine before doing any work (exit 7, `LocalOnlyCommandError`): `cvm file`, `cvm course readiness` and `cvm course publish`; the author's machine declares itself with `CVM_LOCAL_MACHINE`. See ADR 0025. Adding a service method is one `.post` in `apps/remote/routes/<noun>.ts` and one `rpcMethod` line in `apps/local/app/cli/rpc-layer.ts`; the route table, the service signature and the argument order are each checked by the build. Most nouns are read-only; the write-capable ones are `beat` (add/update/move/delete), `lesson` (create/update/move), `video` (create/move/update), `file` (add/delete), `pitch` (create/update), `deliverable` (create/update/archive — the deadline surface, ADR 0022) and `course` (publish), each reusing its operations service's write methods. Writes are immediate (no confirmation/dry-run) and flags come before the positional `<id>`. More nouns may gain writes over time. Its `--help` text is a domain-teaching document written in ubiquitous-language terms drawn from `CONTEXT.md`. **Keep the cvm help text and `CONTEXT.md` in sync manually** — when domain vocabulary or entity fields change in `CONTEXT.md`, update the corresponding noun/verb help in `apps/local/app/cli/commands/*.ts` and the root help in `apps/local/app/cli/index.ts`.
