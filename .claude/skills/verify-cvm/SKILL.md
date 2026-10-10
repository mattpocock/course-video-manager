---
name: verify-cvm
description: "Drive the real Course Video Manager web app in a browser and capture proof of what it did. Use to verify a change before opening a PR, to reproduce a reported UI bug, to see what a page actually renders, or to capture a screenshot of app behaviour. Runs on a per-run, writable clone of a local copy of Matt's data by default — click anything that mutates; production is never written to."
---

# Verify CVM

You start a Course Video Manager of your own, drive it through a browser the
way Matt does, and leave behind evidence a human can read without rerunning
anything.

## Your database: a clone of your own

Every run gets **its own copy of Matt's data**. `launch` clones the local
template database `cvm_verify_template` (on the `cvm-local-postgres` container,
port 5433) into a database only this run uses, starts the server on it, and
`cleanup` drops it:

```text
launch: cloned cvm_verify_template into cvm_verify_20261008_094914_14982
migrate: applied 2 migration(s) the template lacks, to cvm_verify_20261008_094914_14982 only:
  0027_video_format_repair
  0028_clip_transcription_status
template: 1 day(s) old (as of 2026-10-06T18:56:11Z, from the snapshot stamp)
DB: test clone cvm_verify_20261008_094914_14982 (writes allowed, dropped on cleanup)
```

**Your clone has your checkout's schema.** Right after cloning, `launch`
applies every migration in your worktree's `packages/core/db/migrations` that
the clone lacks — your branch's new one included — to the clone only, before
the server starts and before the Ledger's triggers go in (so a migration's own
writes never show in your Ledger). It prints what it applied, and keeps the
list in `migrations.txt` in the run directory. It refuses any target but
localhost:5433 and this run's own `cvm_verify_<id>` clone: the template is
never migrated. The template still moves only when Matt runs
`pnpm db:verify-snapshot` — that is how its _data_ gets newer, and agents still
never run it. A failed migration stops the launch.

So **writes are allowed — verify the write path for real.** Create, edit,
reorder, archive, delete: press the button that mutates and then read the row
back. Nothing you do can reach Matt's data, his files or the outside world:

- The data is a copy, minus the credential tables. Nothing else writes to it,
  so every row in your [Write Ledger](#the-write-ledger) is yours.
- File writes (Video files, Clip Mockups, renders, finished videos) go to
  `scratch/` in the run directory, never Matt's disk.
- Every external service's credential is replaced with a dud, so Buffer, S3,
  Dropbox, YouTube, Anthropic and AI Hero all fail closed. A feature
  whose point is an external call shows its error path here, not its success.
- No `.env` is needed. Do not link one.

**Never write to production.** Production is reachable only by asking for it
by name — `$V launch --production` — and even then the server's own connections
are read-only (`default_transaction_read_only`), so a write comes back a 500
instead of landing. Use it only to _look at_ data newer than the template (a bug
Matt reported on something he made this morning), never to test a write. See
[Production, read-only](#production-read-only).

### If the template is missing, or old

`launch` fails rather than guess when there is no template:

```text
FAIL: the verify template database cvm_verify_template does not exist on localhost:5433.
  Stop and ask Matt to run:  pnpm db:verify-snapshot
```

Do exactly that: stop and ask Matt. **Never run `pnpm db:verify-snapshot`
(`scripts/verify-snapshot.sh`) or `scripts/setup-verify-db.sh` yourself** — the
snapshot is the one step that reads production, only Matt runs it from his own
terminal, and both refuse an agent's shell. Do not fall back to `--production`
on your own either. If Postgres itself is unreachable, `docker start
cvm-local-postgres` is fine.

Read the template's age before you rely on recent data:

```bash
$V template      # exists? how big? how old?
```

```text
template: cvm_verify_template on localhost:5433 — 95 MB
template: 0 day(s) old (as of 2026-10-06T18:56:11Z, from the snapshot stamp)
```

The age comes from the stamp `pnpm db:verify-snapshot` leaves on the template,
or — for a template made before it stamped — the newest `created_at` /
`updated_at` in it. `launch` prints the same line. At **14 days or more** it
warns and carries on; nothing fails. Carry on with your verification, and say
in your report that the template wants `pnpm db:verify-snapshot` (Matt's to
run). Anything Matt made after the "as of" time is not in your clone.

The one thing a run always produces is a **Write Ledger** — a per-run record of
every insert, update and delete the database took while you were driving.

The harness is one script. Every command below is a verb of it:

```bash
.claude/skills/verify-cvm/scripts/verify.sh   # prints its own usage
```

## Launch

The checkout you drive must be your own — a worktree, not Matt's working copy.
It needs `node_modules`, which Git does not carry:

```bash
pnpm install                 # ~seconds from the pnpm store
```

```bash
V=.claude/skills/verify-cvm/scripts/verify.sh
$V launch
```

Every launch first sweeps up clones that crashed runs left behind — in this
checkout or any sibling worktree — so you never need to tidy someone else's.

**Verification runs live in 5200-5299, and the CVM never does.** The CVM owns
5170-5199 — 5172 is the Stream Deck forwarder hub, 5173 Matt's own dev server,
5174 the forwarder's HTTP side. `launch` takes a free port of the verification
band, asks for exactly it, and refuses a server that comes up anywhere else.

`launch` prints the **run id** (alone on stdout) and where everything lands:

```text
DB: test clone cvm_verify_20261007_143020_2714708 (writes allowed, dropped on cleanup)
ready:    http://localhost:5200/  (pid 2715404)
session:  verify-cvm-20261007-143020-2714708
evidence: /…/<your worktree>/.verify/run-20261007-143020-2714708
run id:   20261007-143020-2714708   <- pass it to every later verb
```

### The run's sidecar

A clone run also starts a background-jobs **Sidecar** of its own
(`apps/local/sidecar/`) on the same clone, with the same scratch folders and
dud credentials, once the server answers. `launch` prints its pid and socket:

```text
sidecar:  pid 1643294, socket /run/user/1000/cvm-sidecar-<run id>.sock, job logs in <evidence>/logs/jobs
```

Its socket is a Unix socket named by the run id, never a port, and the run's
server is pointed at it (`CVM_SIDECAR_SOCKET`): an Export pressed in the
browser runs in this sidecar, and its row and toasts come from its Job Events. Its output is
`<evidence>/sidecar.log`, and each Job's log is `<evidence>/logs/jobs/<job id>.jsonl`.
Transcription runs for real on a clone: Local Whisper on the GPU, inside the
clone's sidecar. Its env and model are shared in `~/.cache/cvm/whisper`; only
a machine's first start builds them (minutes).
**Posting never leaves the box.** Every posting service's base URL —
`YOUTUBE_API_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `BUFFER_API_URL`, `S3_ENDPOINT`,
`AI_HERO_BASE_URL`, `DROPBOX_API_URL`, `DROPBOX_CONTENT_URL` and
`CLOUDINARY_UPLOAD_PREFIX` — is set to the discard port (127.0.0.1:9) on a clone run.
To see a post succeed, start a local stub and export the variable as a plain
loopback URL (`http://127.0.0.1:<port>` or `http://localhost:<port>`, a path at
most) before `launch`; anything else is replaced by the discard port. Read
`/proc/<pid>/environ` of the server and the sidecar to confirm before driving.
The clone has no YouTube, AI Hero or Dropbox tokens: insert dud ones into its
`youtube_auth` / `ai_hero_auth` / `dropbox_auth` tables to reach the stub.
**The model never leaves the box either.** `ANTHROPIC_BASE_URL` gets the same
rule: the discard port, unless you export a plain loopback URL (the AI SDK
wants its `/v1`, e.g. `http://127.0.0.1:<port>/v1`). A Course Autofill — a Job
the run's sidecar runs — then calls a local stub of the Messages API instead of
failing at once.
To run a Job by hand, post it to the socket and read it back:

```bash
S=$(cat "$($V dir <run>)/sidecar.socket")
curl -s --unix-socket "$S" -X POST http://sidecar/jobs -d '{"kind":"noop","title":"check","params":{"durationMs":1000}}'
curl -s --unix-socket "$S" http://sidecar/jobs/<job id>     # the Job and its Job Events
```

A `--production` run has no sidecar: its connections are read-only, so a
sidecar could not hold its lease.

## Your run id is the only handle

**Every verb after `launch` takes the run id as its first argument** —
`$V <verb> <run> …`. There is no default run, no "latest", no environment
variable: a verb without an id fails, and so does an id this worktree did not
launch. Shell variables do not survive between your commands, so write the id
out in each one:

```bash
AB="$V ab 20261007-143020-2714708"   # this run's browser, pinned to this run's server
$AB open /                           # a path opens on this run's server
$V shot 20261007-143020-2714708 01-home      # → <evidence>/01-home.png
$V snap 20261007-143020-2714708 01-home -i -c -d 3   # → <evidence>/01-home.snapshot.txt
```

A run belongs to the worktree that launched it: its evidence directory is
`<worktree>/.verify/run-<id>/` and it records that worktree, so a command from
any other checkout refuses it. `ab` refuses `--session`, `--profile` and
`close --all`, and any `localhost` URL on a port that is not this run's. Each
run has its own port, browser session, database and evidence directory, so
parallel runs never meet. A run is also cut off from Matt's desk: its pages
point the Stream Deck hub and OBS at a dead port, so his button presses never
reach a run's editor and nothing a run does reaches his — Stream Deck and OBS
behaviour cannot be verified here. Keep your own logs in the evidence directory too
(`$V dir <run>`), never shared `/tmp`.

`.verify/` goes when your worktree does: copy the evidence directory out first
if your report must outlive it.

## Doctor

Run it after launch, and again the moment anything looks wrong:

```bash
$V doctor <run>
```

It reports, read-only: the server process alive, the run's port outside the
CVM's band, the port owned by _this_ run's pid, `/` answering 200, which
database the run is on (`DB: test clone …` or `DB: PRODUCTION …`), psql
reaching it, the run's sidecar alive, answering on its socket and holding the
lease in this run's clone, and which other verification runs are live. Any FAIL means stop
and fix — a snapshot taken against someone else's server proves nothing.

**Who may own the port.** The listener passes only if it is the pid `launch`
recorded, or a **direct** child of it (its parent pid is the recorded pid).
`react-router dev` relaunches itself as a child node process
(`[restart] Relaunching with --conditions=development`), and the child is what
binds the port; doctor then says
`ok   port 5200 owned by this run (pid <child>, a direct child of <pid>)`.
A grandchild, or any process whose parent is not the recorded pid, still
FAILs. `cleanup` stops that child too: it signals the recorded pid's direct
children before the pid itself.

**Never drive a port by hand.** 5173 is Matt's CVM, running all day against
production; other ports in 5200-5299 are sibling runs. `$V ab <run>` only goes
to your own.

## Drive

`agent-browser` is the harness. Load its own guide once per session before
driving:

```bash
agent-browser skills get core
```

Always go through `$AB` (`$V ab <run>`), never `agent-browser` directly, so
your browser and your server are both this run's:

```bash
$AB open /
$AB snapshot -i -c -d 4
```

Three things about this app specifically:

- **Navigate by URL, not by the sidebar.** The sidebar renders as a collapsed
  rail; its course links appear in the snapshot but a click on one does not
  navigate. Read the href with `snapshot -i -u`, then `open` it.
- **Drive by role and text.** There is one `data-testid` in the whole app, so
  stable handles are ARIA roles, accessible names and route paths — `$AB find
role button click --name "Publish"`, `$AB find text "All Lessons" click`.
- **Scope every snapshot.** A course page carries whole Learning Goals and
  descriptions in its accessibility tree; an unscoped `snapshot` runs to tens of
  thousands of tokens. Use `-i -c`, cap with `-d 3`, or scope with `-s
"<selector>"`.

[`features/`](features/README.md) maps the app's user-facing features: how to
reach each one, how to drive it, and what end state proves it works. Read the
index before you decide a feature is verified — a proof that drives one
convenient page is incomplete when the map lists three more entry points into
the same behaviour.

## Checking a `cvm` command

**To check a `cvm` command, use `$V cvm <run> <args…>`; never mock the gates.**
See [`checking-cvm.md`](checking-cvm.md).

## The Write Ledger

Open the window before you drive, close it after:

```bash
$V guard <run> baseline     # before the first browser command
# ... drive ...
$V guard <run> check        # writes WRITE-LEDGER.md into the evidence directory
$V guard <run> forensics course-video-manager_pitch   # name the rows behind a line
```

**The Ledger never says "clean" on a guess.** It used to read
`pg_stat_user_tables`, and those counters lag — each backend flushes them
only every so often — so it once called a real UI save "clean". It now rests
on two exact sources:

- **On a clone, triggers.** `launch` puts statement-level triggers on every
  table of the clone before the server starts. Each committed insert, update,
  delete and truncate records itself in `verify_ledger.write` inside the
  writing transaction, so a save shows up the moment it commits — and a write
  that rolled back never does. Each records **who wrote it** too: the server
  and the sidecar connect under their own `PGAPPNAME`, and the trigger keeps
  the session's `application_name`.
- **In both modes, the app's own statement log.** The server runs with
  `CVM_LOG_SQL=1` and prints every statement it sends as a `[cvm-sql]` line in
  `server.log`. The Ledger lists the ones that could write.

Three verdicts other than clean, and none of them is clean:

- **PENDING** — a session still held an uncommitted write five seconds after
  you ran `check`. Run `guard check` again once the page settles.
- **UNKNOWN** — a table has no ledger trigger (created after launch), or the
  server is not logging its statements. Say so in your report; never call it
  clean.
- On production, **write attempted** — see [Production,
  read-only](#production-read-only).

`forensics` prints every row of one table whose `created_at` or `updated_at`
falls inside your window, into `forensics-<table>.txt`.

On a clone the database is this run's alone, so every row in the Ledger is
your own write. It splits them by the connection that wrote them, never by
table — the server writes `job` and `job_event` rows itself (an Export it
enqueues, a Job it dismisses):

- **Writes committed by this run's server** — what your clicks wrote. Any
  row here makes the verdict `writes landed`, job tables included.
- **Writes committed by other connections** — your own `psql`, a seed
  script; named by `application_name`. These count as writes too.
- **Background, committed by this run's sidecar** — its lease, renewed every
  few seconds, and the Jobs it runs. Listed, never counted against you; a
  window with only these reads `no write from this run's server — only the
sidecar's background`, never `clean`.
- **Sent but not committed** — per table, any table the server sent a write
  statement to (from `[cvm-sql]`) without committing a row there: rolled back,
  rejected, or matched nothing.

```text
guard: writes landed in this run's test clone (allowed) — server: course-video-manager_job, course-video-manager_job_event; other connections: none; sidecar: course-video-manager_job, course-video-manager_job_event, course-video-manager_sidecar_lease — see …/WRITE-LEDGER.md
```

`clean — no writes` means no connection committed a row at all.

Check each table it names is one you meant to write, and report any you did
not expect — a button that writes three tables when it should write one is a bug
the run found.

## What not to press

**Publish only the Tiny Course; never Publish, Export or otherwise encode a
real Course on a clone** — one real Publish took the machine to the edge of
its memory. `$V tiny-course <run>` seeds a one-Video, 2.5-second Course and
prints its id ([features/publish.md](features/publish.md)). Publish ships a
Bundle to Dropbox; on a clone both its hosts are the discard port or your
loopback stub (`DROPBOX_API_URL`,
`DROPBOX_CONTENT_URL`, above). Press it only with a stub running and both
confirmed in `/proc/<pid>/environ` of the server **and** the sidecar; without
one it fails at the Commit and Discards its Pending Version, a fine failure
path. Never press it on `--production`.

**Autofill** on that same page calls Anthropic, and on a clone that call can
only reach the discard port or your own loopback stub (`ANTHROPIC_BASE_URL`,
above). Press it only with a stub running: without one every Video fails, which
is a fine failure path but writes nothing.

## Production, read-only

`$V launch --production` starts the server on production instead of a clone.
Reach for it only when the data you must look at is newer than the template,
and only to look. It needs `.env` (`ln -s ../../.env .env` from a
`.worktrees/<name>` worktree; adjust the depth otherwise), and launch prints:

```text
DB: PRODUCTION (read-only: the server cannot write)
```

- **The server cannot write.** Its connections run with
  `default_transaction_read_only`, so any write — yours or a stray click — comes
  back a 500 (`PreventCommandIfReadOnly`). A write path you need to verify goes
  on a clone, never here.
- **The Ledger is your proof you changed nothing**, and its verdict is this
  run's own statements: `[cvm-sql]` lines with no write among them read
  `clean — this run's server sent no write statement`. A write statement reads
  `WRITE ATTEMPTED ON PRODUCTION (refused by read-only)`; anything that tries to
  lift the read-only guard reads `READ-ONLY OVERRIDE ATTEMPTED` — tell Matt at
  once. No `[cvm-sql]` lines at all reads UNKNOWN.
- **The database-wide counters are a lead on other writers, never the
  verdict.** Matt's own instance, the deployed `apps/remote` and sibling
  production runs write to the same tables, and the counters lag, so a moved
  counter may be someone else's and an unmoved one proves nothing. Run
  forensics on a moved one, and keep the window tight — `guard baseline`
  immediately before driving, not at launch. `doctor` names the other live runs
  for this reason.
- **The `api_token` line is background, not a write.** Every `cvm` call
  authenticates against `apps/remote` and bumps that token's `last_used_at`.
  `guard` fingerprints every token row minus `last_used_at`; when only that
  moved, the Ledger prints it on its own line —
  `Background (apps/remote token usage — expected): …` — rather than in the
  writes table. Do not run forensics on it or report it. Anything else on
  `api_token` is a write like any other.
- **Report a non-clean Ledger to Matt at the top of your reply**, before
  anything else — the table, the row ids from forensics, what you were driving
  at the time, and whether you believe it was you, his own instance, or a
  sibling run. This holds even when you are sure it was not you.
- **Read rows back with `cvm`**, not `sql`, which refuses production runs.

## Evidence

Everything lands in the evidence directory `launch` printed (`$V dir <run>`). What makes it a proof:

- **The real user path.** Reach a feature the way Matt reaches it — the route,
  the button. An internal API call you crafted proves the API, not the app.
- **The action and its result.** Capture the state before your action and the
  state after, not only the final screen: `$V shot <run> <step>` and
  `$V snap <run> <step> -i -c`.
- **The side effect too.** A page that looks right over a row that did not
  change is a failure. Check the Ledger, and read the row back where the change
  was meant to persist: `$V sql <run> 'select … from "course-video-manager_video"
where …'` (or the query on stdin). It reads this run's clone, read-only, and
  logs the query and result to `sql.log` in the run directory. Plain `cvm`
  reads production: not finding your row there proves it stayed in the clone.
- **The console.** `$AB errors` and `$AB console` catch the hydration failure a
  screenshot renders straight through.

Name files after the step. A human reading the directory in order should be able
to follow what you did.

## Cleanup

```bash
$V cleanup <run>     # this run
$V cleanup --all     # every live run this worktree launched
```

It stops the run's API and sidecar (SIGTERM, so it puts back any Job it was
running and lets go of its lease) and removes its socket, then kills the pid this run recorded — never a process matched by name, which
would take Matt's server and every sibling run with it — closes this run's
browser session, **drops the run's clone**, and leaves the rest alone. `--all`
also sweeps the clones crashed runs left behind (as every `launch` does): any
whose run is no longer live, in any worktree, and any unclaimed, unconnected
`cvm_verify_*` database over six hours old. A sibling worktree's live run is
never touched. **The evidence survives**: the run directory is left whole, and its path is printed. Quote that path in your
report.

Run cleanup after a failed attempt too, so a broken run leaves no server holding
a port.
