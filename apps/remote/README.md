# `@cvm/remote`

The deployed RPC API. A Hono app that exposes the domain operations from
`@cvm/core` to a `cvm` running anywhere, authenticated with a bearer token.

It exists so that a machine other than the author's can read and write Courses,
Videos, Scripts, Beats and Pitches — **without a Postgres connection string ever
going near that machine**. A compromised box hands over a token the author can
revoke in one click, not full database credentials.

## What is here

| File         | What it is                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | The Vercel entry point. Default-exports the app; nothing else.                                                                            |
| `app.ts`     | The verb groups, mounted. `RemoteApp` is the type the CLI's client is built from.                                                         |
| `auth.ts`    | Bearer authentication. One answer for every way a token can be no good.                                                                   |
| `version.ts` | The version gate: a caller built against another schema is refused outright, with both numbers and the word "pull".                       |
| `runtime.ts` | The single module-scope `ManagedRuntime`.                                                                                                 |
| `rpc.ts`     | The Effect/HTTP boundary: an Effect's two channels become the envelope, and `forward`, which is every route.                              |
| `routes/`    | One file per domain noun: `course`, `version`, `section`, `lesson`, `video`, `clip`, `beat`, `pitch`, `deliverable`, `diagram`, `search`. |

## Rules

**No filesystem.** This runs on a box with no finished videos directory, no
Video Files directory, no ffmpeg, no OBS and no git checkout. `pnpm run
lint:boundaries` makes an `fs`/`path`/`child_process` import a build failure
rather than a runtime error on a machine nobody is watching.

**No authentication rows.** No endpoint reads or writes the YouTube, Dropbox or
AI Hero credentials. They live in the same database because they must, but they
have no RPC surface — so a leaked API token cannot become a leaked YouTube
refresh token. This is a decision about which endpoints exist, not a permissions
system, and it is kept by `@cvm/core/layer` not listing those services.

**One endpoint per CLI verb.** No resource modelling. The API's job is to be the
CLI's transport, so adding a command is one endpoint and no design discussion.
The surface is exactly what `cvm` asks for: a service method no command calls
gets no route, so nothing here is reachable that no verb needs.

**A route is one line.** `forward(runtime, SomeService, "someMethod")` spreads
the request body's argument array into the method. It does not re-declare the
argument shape, because both sides of the call already derive their types from
the same interface in `@cvm/core` — the CLI's client is checked against it (see
`app/cli/rpc-layer.ts`) and this end simply passes the arguments along. A third
copy of a signature TypeScript already checks twice is the copy that drifts.
`routes/search.ts` is the one exception: its `types` parameter is a `Set`, and a
`Set` is not JSON.

**The production build runs the migrations, backup first (#2655).** Merging a
migration to `main` runs it. Only a `VERCEL_ENV=production` build migrates;
preview builds never do (an unmerged PR once could, ADR 0026). If nothing is
pending, the build takes no backup and does nothing. Otherwise it takes a
PlanetScale backup, waits until it is ready, prints its ID, then migrates under
a Postgres advisory lock, so two concurrent builds cannot both migrate. Any
failure fails the build and the previous deployment keeps serving.

The consequence is a rule, not a preference: **every migration must be safe for
the previous code.** The old deployment keeps serving while the build migrates
(and for good if the build fails afterwards), Matt's local CVM runs against
production on whatever checkout it has, and a `cvm` command may be in flight on
some box. So migrations are additive, and a column or table is dropped only
after no deployed or local code reads it: one PR stops reading and writing it,
a later PR drops it (the `deploy-migration` skill, section 4). #2648 is the
worked example: #2576 (PR #2593) removed every read and write of
`overlay.footage_path`/`footage_start` and is what serves, so its `0050` DROPs
break nothing once Matt's local checkout is past #2593. The version gate catches
a stale box's NEXT command; it does nothing for the one already running.

**Routes stay chained, groups stay mounted.** Each `routes/*.ts` returns one
chained `new Hono()...` expression, and `app.ts` mounts it with `.route()`,
because that is what carries the route types out through `RemoteApp`.
Registering routes as separate statements silently erases them from the type,
and the CLI's client is derived from that type — a mismatch should be a compile
error, not a 404.

## Deploying

A Vercel project whose **Root Directory** is `apps/remote`, using Vercel's
first-class **Hono** framework preset — the preset wants the app default-exported
from the entry file and does the rest. There is deliberately no `hono/vercel`
adapter, no `api/` directory and no Vercel adapter package in `package.json`.

Set no Ignored Build Step: Vercel's built-in unaffected-project skipping is what
stops a filming-related commit in `apps/local` triggering an API deploy, and
unlike `turbo-ignore` it does not consume a concurrent build slot.

The `vercel-build` script takes precedence over the preset's own build command.
It checks the build is GitHub's `main` (`scripts/assert-production-source.mjs`),
BUILDS `@cvm/core`, then runs `scripts/migrate-on-deploy.mjs` (logic and tests:
`packages/core/db/migrate-on-deploy.ts`). That migrates a production build as
above, then, for every build, reads production's `drizzle.__drizzle_migrations`
and fails unless this commit's latest migration is applied, so a deploy that
would query schema production does not have is never promoted (PR #1859).

The build is not optional, and the reason is worth stating because the failure
it prevents is silent. Vercel does not bundle — it transpiles each file it can
trace and leaves every import specifier untouched. It traces against the SOURCE
tree, where core is all `.ts`, but the function then runs against the OUTPUT
tree, where the same files are `.js`. A single `exports` map cannot describe
both trees, and either choice breaks one end: point it at `.ts` and the package
is traced, shipped, and then fails to load; point it at `.js` and it is never
traced, so it ships empty. Both present identically — every route, including
`/health`, returns `FUNCTION_INVOCATION_FAILED` because the function dies on
import.

So core emits real JavaScript into `dist/` and its `exports` map points there.
That file exists before the trace and is the same file Node loads afterwards,
which is what removes the disagreement instead of picking a side.

`apps/local` is untouched by any of this: it resolves `@cvm/core/*` through
tsconfig `paths` and reads the source directly, so `dist/` is a deployment
artefact and never part of the local loop.

Environment, all set by Matt in the Vercel project (agents never set them):

| Variable                   | Environments         | Used for                                                                                              |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | all, runtime + build | every query; the build's read of the migrations table                                                 |
| `DIRECT_DATABASE_URL`      | **Production only**  | the build's migrate and advisory lock (PgBouncer cannot hold either). Needed only when pending        |
| `PLANETSCALE_BACKUP_TOKEN` | **Production only**  | `<SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`, `read_backups` + `write_backups` only. Needed only when pending |

A production build with a pending migration and either of the last two missing
fails, naming the variable, before any backup or connection.

## Testing

There are no HTTP-level tests here, on purpose. A Hono app is a `fetch` handler,
so the CLI test harness calls this app directly with no server and no port —
authentication, expiry, revocation and error mapping all surface as a `cvm` exit
code and a line of stderr, which is what the `cli-*` suites already assert on.
See `apps/local/app/cli/cli-remote-test-harness.ts`.

The one thing those suites would not catch on their own is a **lost error tag**:
the tag decides the exit code, so a tag dropped on the wire turns "that Video
does not exist" into "internal error" everywhere at once, and every existing
assertion would keep passing. `apps/local/app/cli/cli-error-round-trip.test.ts`
is the test that names it, group by group.
