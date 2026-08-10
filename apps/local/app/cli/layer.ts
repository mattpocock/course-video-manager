import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { resolveDatabaseUrl } from "@/db/database-url";
import { ensureApiConfig } from "./env";
import { makeRemoteLayer } from "./rpc-layer";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { CourseWriteService } from "@/services/course-write-service";

const NO_DATABASE_MESSAGE =
  "this cvm has no DATABASE_URL, and the verb you ran is one of the groups still wired straight to the database rather than through the API. Run it on the author's machine.";

/**
 * A DrizzleService for a machine that has no database.
 *
 * `DrizzleService.Default` DIES when DATABASE_URL is absent, and it dies while
 * the LAYER IS BEING BUILT — which would take `cvm search` down on a remote box
 * for the sake of verb groups that box never asked for. So when there is no
 * connection string, the in-process half is given a database that builds
 * happily and refuses the moment anything tries to query it. Reading a property
 * yields another one of these; CALLING one is what fails, which is exactly when
 * a command has actually asked for data.
 *
 * This exists only for as long as the in-process half does. When the last verb
 * group moves to the API, this and the layer below it go with it.
 */
const unusableDatabase = (): never =>
  new Proxy(
    (() => {
      throw new Error(NO_DATABASE_MESSAGE);
    }) as never,
    {
      get: () => unusableDatabase(),
      apply: () => {
        throw new Error(NO_DATABASE_MESSAGE);
      },
    }
  );

const drizzleLayer = (): Layer.Layer<DrizzleService> =>
  resolveDatabaseUrl() === undefined
    ? Layer.succeed(DrizzleService, unusableDatabase())
    : DrizzleService.Default;

/**
 * Service layer for the `cvm` CLI.
 *
 * TWO HALVES, and the whole direction of travel is from the second to the
 * first:
 *
 *   REMOTE — provided over HTTP by the deployed API (`apps/remote`). No
 *   Postgres connection string is involved, so these verbs work from any
 *   machine that has a token. `search` is here.
 *
 *   IN-PROCESS — still wired straight to a database. Everything else, until its
 *   verb group lands on the API. Moving a group is a one-line edit: drop its
 *   `.Default` from the list below and add it to `makeRemoteLayer`.
 *
 * The services keep the same TAGS across the move, so no command handler knows
 * which half it is talking to.
 *
 * WRITES. The CLI is read-mostly, but a handful of write verbs exist (lesson
 * create/update/move, video create/move/update, pitch/beat authoring). Field
 * edits (a title, a link) go straight through the DB-operations services.
 * Structural edits (reorder, move) route through CourseWriteService — pure
 * DB writes with no filesystem or git coupling.
 *
 * Publish-only services (CoursePublishService, ...) remain out of scope.
 *
 * The read services cover all 10 nouns:
 *   course        -> CourseOperationsService
 *   version       -> VersionOperationsService
 *   section       -> LessonSectionOperationsService
 *   lesson        -> LessonSectionOperationsService
 *   video         -> VideoOperationsService
 *   clip          -> ClipOperationsService
 *   beat          -> BeatOperationsService
 *   pitch         -> PitchOperationsService
 *   deliverable   -> DeliverableOperationsService
 *   search        -> SearchOperationsService (cross-cutting: walks the tree)
 *
 * NOTE: CliOutput is NOT in this layer. It is provided per-run at the program
 * edge so tests can swap in a captured implementation (see ./output.ts and
 * ./main.ts).
 */
const inProcessLayer = Layer.mergeAll(
  CourseOperationsService.Default,
  VersionOperationsService.Default,
  LessonSectionOperationsService.Default,
  VideoOperationsService.Default,
  ClipOperationsService.Default,
  BeatOperationsService.Default,
  PitchOperationsService.Default,
  DeliverableOperationsService.Default,
  CourseWriteService.Default
).pipe(Layer.provideMerge(Layer.suspend(() => drizzleLayer())));

/**
 * Built on first use, not at module load, so `runCli` gets to check the
 * configuration and print a clean error before this ever runs.
 */
const remoteLayer = Layer.suspend(() => {
  const config = ensureApiConfig();
  if (!config.ok) throw new Error(config.error.message);
  return makeRemoteLayer({ baseUrl: config.baseUrl, token: config.token });
});

export const cliLayer = Layer.mergeAll(remoteLayer, inProcessLayer);

/**
 * The shared runtime every CLI command runs through. Built once. Both the HTTP
 * client and any DB connection are created lazily on first service use, so this
 * is safe to construct at module load (the environment is ensured before the
 * first run — see ./env.ts and ./main.ts).
 */
export const cliRuntime = ManagedRuntime.make(cliLayer);

/** The full context the runtime provides (every read-operations service). */
export type CliServices = ManagedRuntime.ManagedRuntime.Context<
  typeof cliRuntime
>;
