import { Command } from "@effect/cli";
import { ConfigProvider, Effect, Layer } from "effect";
import * as NodeContext from "@effect/platform-node/NodeContext";
import { DrizzleService } from "@/services/drizzle-service.server";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { discardStrandedPendingVersion } from "@/services/pending-recovery.server";
import { loadRepoEnv } from "@/services/repo-env";
import { requireLocalMachine } from "@/cli/local-only";
import { detail, emitObject } from "@/cli/helpers";
import { entityIdArg } from "../entity-id";

/**
 * `cvm course publish discard <courseId>` (#2621): Discard the course's
 * stranded Pending Version, as the publish page's banner does, for a run with
 * no page. The guards live in `discardStrandedPendingVersion`.
 */

/** What the refusal says this verb needs. */
const NEEDS_THE_RECEIPT =
  "it reads the course.json receipt from Dropbox with this machine's Dropbox credentials before it Discards anything";

/**
 * Enough to read the Pending Version, the course's Jobs and the Dropbox
 * receipt, and to Discard. No Sidecar, no ffmpeg.
 */
const discardLayer = Layer.mergeAll(
  CourseOperationsService.Default,
  VersionOperationsService.Default,
  LinkAuthOperationsService.Default,
  JobOperationsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  )
);

const DISCARD_HELP = `Discard the course's stranded Pending Version.

A Publish cut off after Submit (its Sidecar stopped or died) ends
"interrupted" and leaves a Pending Version. While one exists, no new Publish
can Submit. This Discards it, as the publish page's banner does: the Pending
Version is deleted, and its content lives on in the Draft that Submit made
(see Discard in GLOSSARY.md).

GUARDS (each refusal is PendingDiscardRefusedError, exit 3, nothing changed)
  reason "publish-in-flight"   this course's Publish is queued or running; it
                               Promotes or Discards its own Pending Version.
  reason "release-landed"      the course.json receipt in Dropbox names this
                               Pending Version: the release is out. Promote it
                               on the publish page instead.
  reason "receipt-unreadable"  Dropbox could not be read (no credentials, an
                               unreadable receipt), so whether the release
                               landed is unknown.
  No Pending Version at all is NotFoundError, exit 2.

LOCAL-ONLY
  It reads the receipt with this machine's Dropbox credentials. On any other
  box it is refused: LocalOnlyCommandError, exit 7.

OUTPUT
  { discardedVersionId, name }: the id and release name of the Pending
  Version it deleted.

EXAMPLES
  cvm course publish discard course_123`;

const discardCmd = Command.make(
  "discard",
  { courseId: entityIdArg("course", "courseId") },
  ({ courseId }) =>
    requireLocalMachine("cvm course publish discard", NEEDS_THE_RECEIPT).pipe(
      // loadRepoEnv MUST run before discardLayer is built: DrizzleService
      // reads DATABASE_URL from process.env.
      Effect.zipRight(Effect.sync(() => loadRepoEnv())),
      Effect.zipRight(
        discardStrandedPendingVersion({ courseId }).pipe(
          Effect.flatMap(emitObject),
          Effect.provide(discardLayer),
          Effect.withConfigProvider(ConfigProvider.fromEnv())
        )
      )
    )
).pipe(Command.withDescription(detail(DISCARD_HELP)));

/**
 * `cvm course publish discard …` is parsed by a command tree of its own.
 * `@effect/cli` parses a parent command's own options before a subcommand's,
 * so `publish`'s required `--name` and `--description` would be demanded of
 * `publish discard` too. `main.ts` routes these argv here instead.
 */
export const isPublishDiscardArgv = (argv: ReadonlyArray<string>) =>
  argv[0] === "course" && argv[1] === "publish" && argv[2] === "discard";

export const publishDiscardCommand = Command.make("cvm").pipe(
  Command.withSubcommands([
    Command.make("course").pipe(
      Command.withSubcommands([
        Command.make("publish").pipe(Command.withSubcommands([discardCmd])),
      ])
    ),
  ])
);
