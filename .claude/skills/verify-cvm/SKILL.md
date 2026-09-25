---
name: verify-cvm
description: "Drive the real Course Video Manager web app in a browser and capture proof of what it did. Use to verify a change before opening a PR, to reproduce a reported UI bug, to see what a page actually renders, or to capture a screenshot of app behaviour. Runs against the PRODUCTION database, so read the write rules before driving."
---

# Verify CVM

You start a Course Video Manager of your own, drive it through a browser the
way Matt does, and leave behind evidence a human can read without rerunning
anything.

**The database is production.** There is no seed data and no test fixture: every
Course, Video, Clip and Deliverable you see is Matt's real work. So this skill
is **read-only by default**, and the one thing it always produces is a **Write
Ledger** — a per-run record of every insert, update and delete the database took
while you were driving. A clean Ledger is the proof you changed nothing.

The harness is one script. Every command below is a verb of it:

```bash
.claude/skills/verify-cvm/scripts/verify.sh   # prints its own usage
```

## Launch

The checkout you drive must be your own — a worktree, not Matt's working copy.
It needs two things Git does not carry:

```bash
pnpm install                 # ~seconds from the pnpm store
ln -s ../../.env .env        # from a .worktrees/<name> worktree; adjust depth otherwise
```

`.env` holds `DATABASE_URL`. Without it the server starts and every page 500s.

```bash
.claude/skills/verify-cvm/scripts/verify.sh launch
```

This starts `react-router dev` on **port 5199**, waits for `/` to answer, and
prints the **run directory** (`.verify/run-<timestamp>/`) that holds the pid,
the server log and all your evidence. It refuses to start a second server while
one is up.

Port 5199 is yours alone. **Port 5173 belongs to Matt** — his own CVM runs there
all day against the same production database. Driving it would type into the
window he is looking at. Leave it alone; the doctor tells you when it is up.

## Doctor

Run it after launch, and again the moment anything looks wrong:

```bash
.claude/skills/verify-cvm/scripts/verify.sh doctor
```

It reports, read-only: the server process alive, port 5199 owned by _this_ run's
pid, `/` answering 200, which database `.env` points at, psql reaching it, and
whether Matt's instance is up. Any FAIL means stop and fix — a snapshot taken
against someone else's server proves nothing.

## Drive

`agent-browser` is the harness. Load its own guide once per session before
driving:

```bash
agent-browser skills get core
```

Always pass `--session verify-cvm` so your browser is isolated from any other
agent-browser session on this box:

```bash
AB="agent-browser --session verify-cvm"
$AB open http://localhost:5199/
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

## The Write Ledger

Open the window before you drive, close it after:

```bash
V=.claude/skills/verify-cvm/scripts/verify.sh
$V guard baseline     # before the first browser command
# ... drive ...
$V guard check        # writes WRITE-LEDGER.md into the run directory
```

`guard` reads `pg_stat_user_tables`, Postgres's own count of the inserts,
updates and deletes each table has taken. It costs a catalog read, never a table
scan, so run it around every drive.

The counters are **database-wide**: Matt's own instance and the deployed
`apps/remote` write to the same tables. So a moved counter is a lead, not a
verdict. Name the rows behind it:

```bash
$V guard forensics course-video-manager_video
```

That prints every row of the table whose `created_at` or `updated_at` falls
inside your window, into `forensics-<table>.txt`.

**Report a non-clean Ledger to Matt in your reply, at the top, before anything
else** — the table, the row ids from forensics, and what you were driving at the
time. Say plainly whether you believe it was you or his own instance. This holds
even when you are confident it was not you: he asked to hear about it either way,
and a false alarm costs him one glance.

## Writing to production

Reading proves most things. When a change genuinely needs a write to verify —
a form submit, a reorder, a status toggle — three rules hold:

1. **Create something new; never edit something that exists.** Title it
   `ZZ-VERIFY-<timestamp>` so it sorts to the bottom of every list and reads as
   scaffolding to a human who finds it.
2. **Write down what you created**, id and all, in `run.txt` in the run
   directory, before you create the next thing.
3. **Archive it before cleanup**, through the same UI path a user would take.
   Most CVM nouns soft-delete (`archived`), so the row survives — say so in your
   report rather than claiming you removed it.

Two pages are off limits to writes entirely, because their writes leave the
database: the **publish page** (`/courses/:id/publish`) Submits a Draft Version
and ships a Bundle to Dropbox, and **Autofill** on that same page spends
Anthropic tokens rewriting real Video descriptions and Chapters. Observe them,
screenshot them, read their counts — press nothing.

## Evidence

Everything lands in the run directory `launch` printed. What makes it a proof:

- **The real user path.** Reach a feature the way Matt reaches it — the route,
  the button. An internal API call you crafted proves the API, not the app.
- **The action and its result.** Capture the state before your action and the
  state after, not only the final screen. `$AB screenshot "$RUN/<step>.png"` and
  `$AB snapshot -i -c > "$RUN/<step>.snapshot.txt"`.
- **The side effect too.** A page that looks right over a row that did not
  change is a failure. Check the Ledger, and read the row back with `cvm` where
  the change was meant to persist.
- **The console.** `$AB errors` and `$AB console` catch the hydration failure a
  screenshot renders straight through.

Name files after the step. A human reading the directory in order should be able
to follow what you did.

## Cleanup

```bash
.claude/skills/verify-cvm/scripts/verify.sh cleanup
```

It kills the pid this run recorded — never a process matched by name, which
would take Matt's server with it — closes the `verify-cvm` browser session, and
clears the run pointer. **The evidence survives**: the run directory is left
whole, and its path is printed. Quote that path in your report.

Run cleanup after a failed attempt too, so a broken run leaves no server holding
port 5199.
