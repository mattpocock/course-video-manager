import * as NodeContext from "@effect/platform-node/NodeContext";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { loadRepoEnv } from "@/services/repo-env";
import { NEEDS_FOOTAGE_ON_DISK, requireLocalMachine } from "@/cli/local-only";

/**
 * Footage is on the author's DISK, so every `cvm footage` verb is local-only.
 * Each yields this first, before its argument is even looked at (see
 * local-only.ts): a Remote Box has no raw footage and could never succeed.
 */
export const requireLocalFootage = requireLocalMachine(
  "cvm footage",
  NEEDS_FOOTAGE_ON_DISK
);

/**
 * What a `cvm footage` verb that enqueues Jobs runs inside: enough to write
 * the Job rows and follow them. The work itself (the copy, ffmpeg, Whisper)
 * is the Sidecar's, so none of it is built here.
 */
const footageJobLayer = Layer.mergeAll(
  JobOperationsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  )
);

/**
 * Run `effect` with a JobOperationsService: one already provided (a test's,
 * on its own database) as is; otherwise loadRepoEnv runs BEFORE the layer is
 * built, because DrizzleService reads DATABASE_URL from process.env.
 */
export const withFootageJobs = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  A,
  E | Layer.Layer.Error<typeof footageJobLayer>,
  Exclude<R, JobOperationsService>
> =>
  Effect.flatMap(
    Effect.serviceOption(JobOperationsService),
    (
      provided
    ): Effect.Effect<
      A,
      E | Layer.Layer.Error<typeof footageJobLayer>,
      Exclude<R, JobOperationsService>
    > =>
      Option.isSome(provided)
        ? effect.pipe(
            Effect.provideService(JobOperationsService, provided.value)
          )
        : Effect.sync(() => loadRepoEnv()).pipe(
            Effect.zipRight(
              effect.pipe(
                Effect.provide(footageJobLayer),
                Effect.withConfigProvider(ConfigProvider.fromEnv())
              )
            ),
            // Providing more than the onSome branch leaves only narrows R.
            (e) =>
              e as Effect.Effect<
                A,
                E | Layer.Layer.Error<typeof footageJobLayer>,
                Exclude<R, JobOperationsService>
              >
          )
  );
