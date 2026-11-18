import { ConfigProvider, Effect, Layer, Option } from "effect";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { loadRepoEnv } from "@/services/repo-env";

/**
 * What `cvm job`, `cvm thumbnail` and `cvm video post-youtube` read and write
 * on the author's machine's own database connection: the Sidecar's Job queue
 * (which no API route serves) and the Thumbnail rows a YouTube upload sends.
 * Like `cvm course publish` and `cvm footage`, these are LOCAL-ONLY, so the
 * connection is only ever opened where `DATABASE_URL` lives.
 */
const sidecarDatabaseServices = Layer.mergeAll(
  JobOperationsService.Default,
  ThumbnailOperationsService.Default
);

type Provided = JobOperationsService | ThumbnailOperationsService;

/**
 * Run `effect` with those services: on a DrizzleService already provided (a
 * test's, on its own database) as is; otherwise loadRepoEnv runs BEFORE the
 * connection is built, because DrizzleService reads DATABASE_URL from
 * process.env.
 */
export const withSidecarDatabase = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  A,
  E | Layer.Layer.Error<typeof DrizzleService.Default>,
  Exclude<R, Provided>
> =>
  Effect.flatMap(
    Effect.serviceOption(DrizzleService),
    (provided) =>
      (Option.isSome(provided)
        ? effect.pipe(
            Effect.provide(sidecarDatabaseServices),
            Effect.provideService(DrizzleService, provided.value)
          )
        : Effect.sync(() => loadRepoEnv()).pipe(
            Effect.zipRight(
              effect.pipe(
                Effect.provide(
                  sidecarDatabaseServices.pipe(
                    Layer.provide(
                      DrizzleService.Default.pipe(
                        Layer.provide(GitWorktreeProbeLive)
                      )
                    )
                  )
                ),
                Effect.withConfigProvider(ConfigProvider.fromEnv())
              )
            )
          )) as Effect.Effect<
        A,
        E | Layer.Layer.Error<typeof DrizzleService.Default>,
        Exclude<R, Provided>
      >
  );
