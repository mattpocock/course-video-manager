---
status: accepted
---

# The local/remote split, and one HTTP transport for `cvm`

The Course Video Manager holds every **Course**, **Course Version**, **Section**, **Lesson**, **Video**, **Clip**, **Beat**, **Pitch** and **Deliverable** in one Postgres database. That database ran in a container on the author's machine and `cvm` reached it by importing the Effect services in-process, so an agent could only touch the domain data while sitting on that machine — not while filming, not with the laptop closed, not at all when the author was away.

Most of the application genuinely cannot move. OBS drives **Recording Sessions**, ffmpeg computes **Export Hashes** and produces **Exported Videos**, the finished videos directory holds the `.mp4` files, **Video Files** live on disk, DaVinci Resolve and spacedesk are Windows processes, and the Stream Deck hub and the link-capture extension are local ports. The database has no such constraint: it was always Postgres behind a connection string.

So the repo splits along the one axis that is real — **what needs the machine, and what only needs the data**:

- **`apps/local`** — everything that exists today, connected to the database directly.
- **`apps/remote`** — a Hono RPC API on Vercel, the deployed transport.
- **`packages/core`** — the schema, the `DrizzleService` and every `db-*` service. Every piece of SQL in the repo, and nothing filesystem-bound.

`packages/core` and `apps/remote` each carry a dependency-cruiser rule making an `fs`/`path`/`child_process` import a build failure. The boundary is enforced, not remembered.

## Why every `cvm` invocation goes over HTTP, including the author's

The obvious design is two transports: in-process when a `DATABASE_URL` is present, HTTP otherwise. It is rejected, and this is the load-bearing decision in the whole build.

A second path used only on the author's machine would make the HTTP path the one that is **least exercised, on the machine least watched**. Every bug in argument serialisation, every dropped error tag, every route that quietly 404s would be discovered by the agent, alone, at 3am — and never by the author, who would be exercising the other path all day. So there is **one transport**. `cvm` holds no connection string, reads `CVM_API_URL` and `CVM_API_TOKEN`, and the author's own invocations take exactly the route the agent depends on.

The cost is accepted and real: `cvm` stops working when the deployed app is down. It is not how filming happens, and the React Router app — which is how filming happens — still talks to Postgres directly with no extra hop.

## What a token is, and what it is not

Access is an **API Token**: an opaque bearer credential minted from a page in the local UI, stored as a SHA-256 hash, shown to the author once. It carries a name, an expiry and a revocation, and its last-used timestamp is what makes a forgotten token findable. A compromised box therefore hands over something the author revokes in one click, not full Postgres credentials. No endpoint reads the YouTube, Dropbox or AI Hero authentication rows — a guarantee kept by those endpoints not existing, rather than by a permissions system.

**Tokens are unscoped in version one.** A token grants every operation the RPC surface exposes. That is defensible only because of who holds it: one author, boxes they set up, agents they wrote. **The day a token is handed to something the author did not write, scoping becomes urgent** — and it will not announce itself, so it is written down here.

## The version gate, and what it does not cover

The remote box runs `cvm` from a git checkout that is deployed separately from the API, so the two drift by themselves. Every request states the **Schema Version** it was built against — the length of the Drizzle migration journal — and `apps/remote` refuses any difference outright, naming both numbers and telling the caller to pull. An agent that reads that fixes it without asking a human; one that reads a column-not-found error retries.

The gate protects the **next** command a box runs, not the one already in flight. What protects that one is a rule: **migrations are additive-only** — no dropped or renamed column without a two-step release. (Migrations were originally applied by the `apps/remote` deploy and by nothing else, with deliberately no `pnpm db:migrate`, so two writers could never race to alter the production schema; [ADR 0026](0026-migrations-applied-by-hand.md) moved applying them to a manual `pnpm db:migrate`, run by hand, because the deploy ran on every preview build too. The additive-only rule is what keeps that safe.)

## Local-only commands are refused, not ported

`cvm file`, `cvm course publish` and `cvm course readiness` need the Video Files directory, the finished videos directory and ffmpeg. Each checks at the **front** of the command, before argument validation and before a row is read, and fails with a message naming the reason.

Both properties matter, and both are about what happens next. Naming the reason means an agent that reads "this needs the finished videos directory" stops and reports accurately, where one handed an `ENOENT` on an unfamiliar path retries. Failing first means a refused command cannot leave a **Course** half-changed — a `publish` that got as far as **Submit** would strand a **Pending Version**.

The machine is **declared**, with `CVM_LOCAL_MACHINE`, not detected. Every detectable signal is wrong in the dangerous direction: `VIDEO_FILES_DIR` falls back to a path inside the checkout, so a **Remote Box** would silently scatter Video Files into whatever repo it had; `DATABASE_URL` is something this CLI no longer uses; probing for ffmpeg answers a question nobody asked. A declaration also fails safe — a box that has said nothing is treated as remote.

Commands that read domain data and write local files keep composing on the author's machine, and `cvm course publish` still runs there exactly as it did.

One detail is worth stating plainly, because it is the single exception to "one transport": the publish command's own pre-flight reads and `CoursePublishService` build a **database-backed layer inside the handler** rather than going through the CLI's HTTP layer. That is deliberate — Publish runs the whole Version lifecycle transactionally, and it only ever runs on the machine that `apps/local` already connects to the database from. The exception is confined to a command that is refused everywhere else, so no box that has only a token can reach it.

## The backup guarantee that was given up

The local dump service and the backup coordinator are deleted, along with `/api/backup/health`, `/api/backup/dump` and their configuration. Hosted point-in-time recovery replaces them: daily backups, a 30-day window, a restore measured in about an hour.

This is a real loss, recorded plainly. The coordinator refused every CLI write unless a fresh dump could be taken, which made an agent's write **un-losable**. That guarantee is exchanged for a recovery window — and it is given up at exactly the moment an agent starts writing from a machine nobody is watching. It was accepted because two contradictory backup stories are worse than one honest one, and because 30 days of point-in-time recovery survives a holiday where a local dump directory does not. If an agent write is ever lost and the window is what saves it, the hour of restore is the price of this paragraph.

## Considered alternatives

- **Deploying the whole application.** Rejected: about a third of the server-side code cannot leave the machine, and the parts that can are not the parts an agent needs.
- **Putting `DATABASE_URL` on the remote box.** Rejected: a compromised box would hand over full database credentials, including the rows holding YouTube and Dropbox refresh tokens.
- **A second in-process transport for local use.** Rejected — see above. This is the decision the rest of the build rests on.
- **`@effect/rpc` or `@effect/platform`'s `HttpApi`.** Deferred: both are `0.x` packages taking breaking changes on minor bumps with Effect v4 mid-beta, and their main draw — a typed client — is already covered by deriving the client from the Hono app's type. Revisit once v4 is stable and a deployed UI makes OpenAPI generation worth something.
- **Resource modelling the API.** Rejected: one endpoint per CLI verb means adding a command is one route and one client line, with no design discussion. The API's job is to be the CLI's transport.
- **Making the local-only commands work remotely.** Rejected: they need the machine. A remote `publish` would mean shipping the finished videos directory somewhere, which is the opposite of this build.
- **Detecting the machine rather than declaring it.** Rejected: every signal fails in the direction that scatters files or writes nothing where something was expected.

## Consequences

- **`cvm` depends on a deploy being up.** Accepted; filming does not.
- **The CLI test suites are the transport's test suite.** A Hono app is a `fetch` handler, so the harness calls the deployed app with no server and no port; authentication, expiry, revocation, the version gate and error mapping all surface as an exit code and a line of stderr. The one thing that would otherwise pass silently is a lost error tag, so `cli-error-round-trip.test.ts` names it group by group.
- **The exit-code contract grew.** 5 is authentication, 6 an out-of-date checkout, 7 a command that needs the author's machine. Each is a different action — new token, `git pull`, stop — and an agent that cannot tell them apart retries the one thing that will never work.
- **Migrations are additive-only forever, or until a two-step release.** This is now a correctness rule with a deploy behind it, not a preference.
- **Unscoped tokens are a dated decision.** See above; the trigger is a token given to code the author did not write.
- **An agent write is no longer un-losable.** The 30-day window is the whole of the recovery story.
