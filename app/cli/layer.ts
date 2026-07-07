import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { BackupCoordinator } from "@/cli/backup-coordinator";

/**
 * Service layer for the `cvm` CLI. Mostly the read-operations services, provided
 * over DrizzleService.Default.
 *
 * WRITES. The CLI is read-mostly, but a handful of write verbs exist (lesson
 * create/update/move, video create/move/update, pitch/beat authoring). Field
 * edits with no on-disk coupling (a title, a link) go straight through the
 * DB-operations services. Structural edits that MUST stay in sync with the
 * course repo on disk — reordering or moving a REAL lesson renumbers folder
 * prefixes and `git mv`s directories — route through CourseWriteService, the
 * same disk-aware orchestrator the web app uses. Correctness (DB + disk in
 * lockstep) is the rule for every write verb; the CLI does not get a DB-only
 * shortcut that would silently diverge the two.
 *
 * Publish-only services (CoursePublishService, CourseRepoParserService, ...)
 * remain out of scope.
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
export const cliLayer = Layer.mergeAll(
  CourseOperationsService.Default,
  VersionOperationsService.Default,
  LessonSectionOperationsService.Default,
  VideoOperationsService.Default,
  ClipOperationsService.Default,
  BeatOperationsService.Default,
  PitchOperationsService.Default,
  DeliverableOperationsService.Default,
  SearchOperationsService.Default,
  // Disk-aware write orchestrator for structural lesson edits (reorder / move).
  // Its transitive deps (repo-write, sync-validation, NodeFileSystem) close
  // under DrizzleService below; git/fs are only touched when a real lesson moves.
  CourseWriteService.Default,
  BackupCoordinator.Default
).pipe(Layer.provideMerge(DrizzleService.Default));

/**
 * The shared runtime every CLI command runs through. Built once. DB
 * connections are created lazily on first service use, so this is safe to
 * construct at module load (DATABASE_URL is ensured before the first run — see
 * ./env.ts and ./main.ts).
 */
export const cliRuntime = ManagedRuntime.make(cliLayer);

/** The full context the runtime provides (every read-operations service). */
export type CliServices = ManagedRuntime.ManagedRuntime.Context<
  typeof cliRuntime
>;
