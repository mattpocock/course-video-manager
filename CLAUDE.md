## Agent skills

### Backlog

Issues and PRDs live as GitHub issues in `mattpocock/course-video-manager`, managed via the `gh` CLI. See `docs/agents/backlog.md`.

### Triage labels

Canonical defaults, except `ready-for-agent` is spelled `Sandcastle` in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### cvm CLI

`cvm` is a read-mostly CLI (source in `app/cli/`) that exposes this project's domain data to agents, reusing the Effect services. Every noun is read-only **except `segment`**, the first write-capable noun: `segment add/update/move/delete` author a Video's Segment plan (reusing `SegmentOperationsService`'s write methods). Writes are immediate (no confirmation/dry-run) and flags come before the positional `<id>`. More nouns may gain writes over time. Its `--help` text is a domain-teaching document written in ubiquitous-language terms drawn from `CONTEXT.md`. **Keep the cvm help text and `CONTEXT.md` in sync manually** — when domain vocabulary or entity fields change in `CONTEXT.md`, update the corresponding noun/verb help in `app/cli/commands/*.ts` and the root help in `app/cli/index.ts`.
