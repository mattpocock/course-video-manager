# `@cvm/remote`

The deployed RPC API. A Hono app that exposes the domain operations from
`@cvm/core` to a `cvm` running anywhere, authenticated with a bearer token.

It exists so that a machine other than the author's can read and write Courses,
Videos, Scripts, Beats and Pitches — **without a Postgres connection string ever
going near that machine**. A compromised box hands over a token the author can
revoke in one click, not full database credentials.

## What is here

| File         | What it is                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`   | The Vercel entry point. Default-exports the app; nothing else.                                                                 |
| `app.ts`     | The verb groups, mounted. `RemoteApp` is the type the CLI's client is built from.                                              |
| `auth.ts`    | Bearer authentication. One answer for every way a token can be no good.                                                        |
| `runtime.ts` | The single module-scope `ManagedRuntime`.                                                                                      |
| `rpc.ts`     | The Effect/HTTP boundary: an Effect's two channels become the envelope, and `forward`, which is every route.                   |
| `routes/`    | One file per domain noun: `course`, `version`, `section`, `lesson`, `video`, `clip`, `beat`, `pitch`, `deliverable`, `search`. |

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

Environment: `DATABASE_URL` (the pooled PlanetScale string) and
`DIRECT_DATABASE_URL` (direct to primary, for migrations).

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
