## Agent skills

### Backlog

Issues and PRDs live as GitHub issues in `mattpocock/course-video-manager`, managed via the `gh` CLI. See `docs/agents/backlog.md`.

### Landing a change

Every code change lands through a PR from a fresh worktree, merged once `check` is green on an up-to-date branch. Read `docs/agents/merging.md` before you start a change, and again before you merge.

### Triage labels

Canonical defaults, except `ready-for-agent` is spelled `Sandcastle` in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### Verifying a change in the real app

`.claude/skills/verify-cvm/` drives the app in a browser against a per-run clone of Matt's data — writes allowed, never production — and leaves a **Write Ledger** of what it modified. Use it to reproduce a UI bug, too.

**Any change with a visible effect in the UI is checked in the browser with verify-cvm before you open the PR.** Passing tests and a green `check` do not replace it. If the skill isn't loaded (say you were launched from another repo), read `.claude/skills/verify-cvm/SKILL.md` directly and follow it. The PR body states what you clicked and what you saw, with screenshots or the evidence path. A change with no UI effect says so in one line — `No UI change` — instead.

### What the running server printed

`pnpm dev` and `pnpm start` tee their output to `.data/logs/`, one file per
run: `dev-<timestamp>-<pid>.log`. Read the current run with `tail -100
.data/logs/dev-latest.log`, which is a symlink to the run that started last,
and `ls -t .data/logs/dev-*.log` when several dev servers are up and you need a
different one. Runs are kept for a day. Read them when a page throws at
runtime, when the server dies, or to confirm a fix loads: the stack that killed
the process is there and in no test, build artifact or table.
`scripts/run-with-log.sh` is the wrapper. The background-jobs **Sidecar**
(`apps/local/sidecar/`, started by the same `pnpm dev`) prints one JSON object
per line into that log, and also keeps every Job's lines in
`.data/logs/jobs/<job id>.jsonl` — read that file for why a Job failed.

**Slow requests.** Every `makeLoader`/`makeAction` request that takes over 2s
prints one `[cvm-slow-request]` line into the same log, and into `server.log`
on a verify-cvm run:
`{"route":"/api/courses/…/duplicate","method":"POST","ms":3412,"dbStatements":820,"outcome":"ok"}`.
`route` is the URL path, `dbStatements` is how many SQL statements that request
sent, and `outcome` is `threw` for an error or a thrown redirect. A high
`dbStatements` means a row-by-row DB loop, which no static guard can see, so
the route is a candidate for a Job (ADR 0032). List them with
`grep -h cvm-slow-request .data/logs/dev-*.log`. SSE answers, the Job Event
stream and the teleprompter poll are left out. The threshold is in
`apps/local/app/services/slow-request-log.server.ts`.

### Repository layout

A Turborepo monorepo. Two apps: `apps/local` is today's application, and `apps/remote` is the deployed RPC API (a Hono app on Vercel — see [apps/remote/README.md](./apps/remote/README.md)). Three workspace packages under `packages/`:

- `packages/core` — the domain database (the schema, the `DrizzleService`, every `db-*` service and `CourseWriteService`), and every piece of SQL in the repo. Also holds the pure domain logic both apps share, under `features/` (Clip Zoom, Overlay Kind, Bullet Panel, Overlay Transform); `apps/local` reaches those through one-off `@/features/videos/*` aliases in its tsconfig.
- `packages/lucide-icons` — the vendored, append-only lucide icon-node table, plus the tldraw path transpiler behind its own entry point. A top-level package because it has consumers on both sides of the repo: `apps/local` and `packages/overlay-renderer`.
- `packages/overlay-renderer` — the standalone Remotion renderer for Overlay content (Definition Cards, Bullet Panels) and the vertical Shorts overlay. `apps/local` shells out to its built `bin.mjs` rather than importing its render path, so it is EXCLUDED from every root turbo filter (`--filter=!@cvm/overlay-renderer`) and has its own `test`/`typecheck` scripts to run from its own directory.

Neither `packages/core` nor `apps/remote` may import anything filesystem-bound — see their READMEs.

### Testing

Two tiers — don't run a package's full suite by hand. While iterating, run only the specific test file(s) that cover your change, directly via `pnpm --filter <package> test -- path/to/thing.test.ts`; the full unfiltered suite runs in CI on every PR (`.github/workflows/test.yml`), so targeting locally never leaves a change unverified. See `docs/agents/testing.md` for the mechanics; DB-backed tests need Docker Desktop running (one shared `cvm-test-postgres` container, ADR 0046). That file is how to RUN them; [`docs/TESTING_STANDARDS.md`](./docs/TESTING_STANDARDS.md) is how to WRITE them — mock at system boundaries only, never an internal collaborator.

**Windows processes.** Before any script, harness or test starts a Windows-side process (`ffmpeg.exe`, PowerShell, any `.exe`), it calls `guardWindows()` from `apps/local/scripts/windows-guard.ts` and starts the process through it. From a shell, use `pnpm --filter @cvm/local windows-guard -- <exe> [args…]`. The guard refuses while Matt's recorder or OBS is running, and it runs everything at Idle priority on cores 6–9. See CODING_STANDARDS.md, "Background work".

### Checks

`pnpm run check` runs everything CI runs (`check:static` then `test`; CI runs the same scripts as parallel jobs — see the header of `.github/workflows/test.yml`): typecheck (TypeScript 7 `tsc`, patched by `effect-tsgo patch` in `prepare` so it also reports the Effect diagnostics — see the Effect section of `CODING_STANDARDS.md`; `check:effect-tsc` fails if the patch is missing), oxlint (type-aware, so it needs `oxlint-tsgolint`), package boundaries, the five file guards, then the unfiltered test suite (`.github/workflows/test.yml`). Pre-commit runs the fast half, less `check:response-body`, which is CI-only to keep the commit loop short. Each guard in `scripts/` takes `--all` to sweep every tracked file instead of the staged ones. Oxlint is **advisory**: its `correctness` warnings are a standing backlog cleared by hand, so a warning in a file you touch is an invitation, not a blocker — only rules that encode a documented coding standard are errors, and those are green. The same policy governs the Effect rules in each package's `tsconfig.json`. `typescript`, `@effect/tsgo` and `oxlint-tsgolint` are pinned exactly and move together; dependency-cruiser still needs the TS 5 JS API, which a `pnpm.packageExtensions` entry gives it.

### Coding standards

[`CODING_STANDARDS.md`](./CODING_STANDARDS.md) — Effect and config, function signatures, types, entity actions, React Router data flow, keyboard shortcuts, front-end state, interface design, testing. Read it while writing code, not only while reviewing it: "every `any` is a leak" binds the hand that writes the cast. It sits at the repo root rather than in `.sandcastle/` for that reason. Longer detail is one level down, in `docs/` (`TESTING_STANDARDS.md`, `EFFECT_STANDARDS.md`, `DRAFT_GUARD.md`, `KEYBOARD_SHORTCUTS.md`, `FRONTEND_STATE.md`).

### Deep-module packages

Packages under `apps/local/app/packages/` are deep modules — import only through a package's entry points (its root files); everything in `lib/`/`tests/` is private. See [apps/local/app/packages/README.md](./apps/local/app/packages/README.md) before adding or importing one. `packages/lucide-icons` is the same idea promoted to a workspace package: its entry points are `index.ts`, `generator.ts` and `tldraw.ts` (exactly its `exports` map), and it carries its own `.dependency-cruiser.cjs`. `pnpm run lint:boundaries` fans out to every package's own check (it runs in pre-commit alongside `typecheck`), so it enforces all of that plus `packages/core` staying filesystem-free.

### cvm CLI

`cvm` is a read-mostly CLI (source in `apps/local/app/cli/`) that exposes this project's domain data to agents. It reaches that data over HTTP through `apps/remote`, authenticated with a bearer token (`CVM_API_URL` + `CVM_API_TOKEN`) — **there is one transport**, used by the author's invocations and an agent's alike; do not add an in-process fallback. Every verb group goes through it, so `cvm` needs no `DATABASE_URL` (only `course publish`, which runs the publish pipeline in-process on the author's machine, still reads one). Every request states the **Schema Version** its checkout was built against and a mismatch is refused outright (exit 6) — migrations are applied by the `apps/remote` deploy alone, and are additive-only. Eight commands are **local-only** and refuse on any other machine before doing any work (exit 7, `LocalOnlyCommandError`): `cvm file`, `cvm footage`, `cvm clip-mockup`, `cvm diagram`, `cvm course readiness`, `cvm course publish`, `cvm short render` and `cvm clip frame`; the author's machine declares itself with `CVM_LOCAL_MACHINE`. See ADR 0025. A worktree is never the author's machine: **to check a `cvm` change, run it with `verify.sh cvm <run> <args…>`** (verify-cvm skill), which runs the real `cvm` against that run's clone and its own loopback API — never mock the gates. Adding a service method is one `.post` in `apps/remote/routes/<noun>.ts` and one `rpcMethod` line in `apps/local/app/cli/rpc-layer.ts`; the route table, the service signature and the argument order are each checked by the build. Most nouns are read-only; the write-capable ones are `learning-goal` (create/update/move/delete — a Section's pre-Beat planning artifact), `beat` (add/update/move/delete), `clip-mockup` (add/update/move/delete — a Video's **Animatic**: one still image and one spoken line per moment, decided before filming), `clip-mockup-chapter` (add/update/move/delete — the Animatic's dividers; not local-only), `clip-mockup-comment` (add/update/delete — the author's notes on a Clip Mockup or a Clip Mockup Chapter, shown on the teleprompter; not local-only, hard delete), `section` (create/rename/move/archive), `lesson` (create/update/move/archive), `video` (create/move/update/archive/unarchive), `file` (add/delete), `pitch` (create/update), `deliverable` (create/update/archive — the deadline surface, ADR 0022), `diagram` (create — an agent's draft of a new Diagram in the simple shape format: one drawing or a batch, each kept as a Preserved Snapshot with the first restored to the head, each drawn to a PNG through the running app; `snapshot add` — one more Preserved Snapshot restored to the head, an unheld head preserved first; `cvm diagram render <snapshotId>` draws a stored snapshot) `course` (publish) and `short` (render — enqueues the Sidecar's vertical render of a Short and prints the finished file), each reusing its operations service's write methods. Writes are immediate (no confirmation/dry-run) and flags come before the positional `<id>`. More nouns may gain writes over time. Its `--help` text is a domain-teaching document written in ubiquitous-language terms drawn from `GLOSSARY.md`. **Keep the cvm help text and `GLOSSARY.md` in sync manually** — when domain vocabulary or entity fields change in `GLOSSARY.md`, update the corresponding noun/verb help in `apps/local/app/cli/commands/*.ts` and the root help in `apps/local/app/cli/index.ts`.
