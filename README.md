# Course Video Manager

A tool for managing course video publishing workflows — editing metadata, generating descriptions, creating thumbnails, and posting to social platforms.

## Repository layout

A Turborepo monorepo over the pnpm workspace:

| Directory                            | What it is                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/local`                         | The application as it runs on the author's machine: the React Router app, the Video Editor, the Diagram Playground, the Publish flow, ffmpeg, OBS, and the `cvm` CLI |
| `packages/core`                      | The domain database — the Drizzle schema, the `DrizzleService` and every `db-*` operations service. Every piece of SQL in the repo lives here                        |
| `packages/subtitle-overlay-renderer` | The standalone Remotion renderer, with its own toolchain                                                                                                             |

`packages/core` has **no filesystem access, no `child_process` and no git
coupling**, so it can be deployed as well as run locally. `pnpm lint:boundaries`
enforces that — anything that needs a machine is injected from `apps/local`
(see `packages/core/services/diagram-thumbnail-store.ts` for the shape).

`.env` lives at the workspace root: one file for the whole monorepo, which is
also where `cvm` looks for it (`apps/local/app/cli/env.ts`).

### Commands

Run these from the workspace root; Turborepo fans them out and re-runs only what
changed.

| Script                 | Description                    |
| ---------------------- | ------------------------------ |
| `pnpm typecheck`       | Typecheck every package        |
| `pnpm test`            | Run every suite once           |
| `pnpm test:watch`      | Run every suite in watch mode  |
| `pnpm lint:boundaries` | Enforce the package boundaries |
| `pnpm dev`             | Start the local application    |
| `pnpm build`           | Build the local application    |

Each of these filters out `@cvm/subtitle-overlay-renderer`: it ships its own
toolchain (Remotion, and a Chromium download) and has never been part of the
application's checks. Run it with `pnpm --filter @cvm/subtitle-overlay-renderer`.

### Deploys

Vercel gets one project per deployable directory, each with its own Root
Directory, and relies on Vercel's **built-in unaffected-project skipping** to
decide what to deploy. There is deliberately **no Ignored Build Step**:
`turbo-ignore` is deprecated, and native skipping does not consume a concurrent
build slot. If a custom step is ever needed it is `turbo query affected`.

## Database migrations

Schema changes are managed with **drizzle-kit generate / migrate** (versioned SQL files), not `push`. The schema, the migrations and the drizzle config all live in `packages/core`.

### Making a schema change

1. Edit `packages/core/db/schema.ts`.
2. `pnpm db:generate` — creates a new numbered `.sql` file under `packages/core/db/migrations/`.
3. Commit it and deploy `apps/remote`. **Applying migrations is the deploy's job and nobody else's** — there is deliberately no `pnpm db:migrate`, because two writers altering the production schema at once is the failure that rule prevents. See `apps/remote/README.md`.

Migrations are **additive-only**: no dropped or renamed columns without a two-step release. A `cvm` invocation may be in flight while a deploy lands, and it is the additive rule — not the version gate — that keeps that from breaking. The version gate refuses the box's _next_ command, naming both migration counts and telling it to pull (`packages/core/rpc/schema-version.ts`).

### First-time setup on an existing database

If the database was originally created via `drizzle-kit push` and has never run migrations:

```sh
pnpm db:baseline
```

This registers the `0000` baseline migration as already-applied so the deploy's migrate step won't replay the initial `CREATE TABLE` statements.

### Scripts

| Script             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `pnpm db:generate` | Generate a new migration from schema changes         |
| `pnpm db:baseline` | Mark the `0000` baseline as applied (one-time setup) |
| `pnpm db:studio`   | Open Drizzle Studio                                  |

## Zapier Webhook Setup (Buffer Integration)

The app uses a **Dropbox → Zapier → Buffer** pipeline to post videos to social media. When you click "Post to Buffer" in the app, it:

1. Copies the video file into a local Dropbox folder
2. Waits for Dropbox to sync the file to the cloud
3. Sends a webhook to Zapier with the caption and file path
4. Zapier finds the file in Dropbox and adds it to your Buffer queue

### Prerequisites

- **Dropbox desktop client** installed and running (the app uses `dropbox filestatus` to poll sync status)
- **Buffer account** connected in Zapier
- **Zapier account** with access to the Webhooks by Zapier and Buffer integrations

### Environment Variables

| Variable                    | Description                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BUFFER_POSTS_PATH`         | Local path to a folder inside your Dropbox directory where video files are copied before posting (e.g. `~/Dropbox/buffer-posts`) |
| `ZAPIER_BUFFER_WEBHOOK_URL` | The webhook URL generated by your Zapier Zap (see below)                                                                         |
| `AI_HERO_BASE_URL`          | Base URL for the AI Hero instance (e.g. `https://www.aihero.dev`). Required for AI Hero posting integration.                     |

### Creating the Zapier Zap

#### Step 1: Create a "Webhooks by Zapier" trigger

1. Create a new Zap in Zapier
2. For the trigger, choose **Webhooks by Zapier**
3. Select **Catch Hook** as the trigger event
4. Copy the generated webhook URL
5. Set it as the `ZAPIER_BUFFER_WEBHOOK_URL` environment variable in your app

The webhook receives a JSON payload with this shape:

```json
{
  "caption": "Your post caption text",
  "dropboxFilePath": "/full/path/to/buffer-posts/video.mp4"
}
```

#### Step 2: Add a "Dropbox: Find File" action

1. Add an action step and choose **Dropbox**
2. Select **Find File** as the action event
3. Configure it to look up the file using the `dropboxFilePath` value from the webhook payload

#### Step 3: Add a "Buffer: Add to Queue" action

1. Add another action step and choose **Buffer**
2. Select **Add to Queue** as the action event
3. Map the **media** field to the Dropbox file URL from Step 2
4. Map the **text** field to the `caption` value from the webhook payload

#### Step 4: Test and enable

1. Use the app to trigger a test post so Zapier can capture a sample webhook payload
2. Walk through each step to verify the data mapping is correct
3. Turn on the Zap
