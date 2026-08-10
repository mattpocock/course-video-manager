# `@cvm/remote`

The deployed RPC API. A Hono app that exposes the domain operations from
`@cvm/core` to a `cvm` running anywhere, authenticated with a bearer token.

It exists so that a machine other than the author's can read and write Courses,
Videos, Scripts, Beats and Pitches — **without a Postgres connection string ever
going near that machine**. A compromised box hands over a token the author can
revoke in one click, not full database credentials.

## What is here

| File         | What it is                                                                   |
| ------------ | ---------------------------------------------------------------------------- |
| `index.ts`   | The Vercel entry point. Default-exports the app; nothing else.               |
| `app.ts`     | The routes, chained. `RemoteApp` is the type the CLI's client is built from. |
| `auth.ts`    | Bearer authentication. One answer for every way a token can be no good.      |
| `runtime.ts` | The single module-scope `ManagedRuntime`.                                    |
| `rpc.ts`     | The Effect/HTTP boundary: an Effect's two channels become the envelope.      |
| `routes/`    | Per-verb-group request parsing.                                              |

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

**Routes stay chained.** `createApp` returns one chained `new Hono()...`
expression because the chain is what carries the route types out through
`RemoteApp`. Registering routes as separate statements silently erases them from
the type, and the CLI's client is derived from that type — a mismatch should be
a compile error, not a 404.

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
