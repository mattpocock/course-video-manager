import { Layer, ManagedRuntime } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { SegmentOperationsService } from "@/services/db-segment-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";

/**
 * READ-ONLY layer for the `cvm` CLI. Mirrors app/services/layer.server.ts but
 * is DELIBERATELY narrowed to the read-operations services, provided over
 * DrizzleService.Default.
 *
 * Write/publish services (CourseRepoWriteService, CoursePublishService,
 * CourseRepoParserService, CourseWriteService, ...) are intentionally OUT OF
 * SCOPE — the CLI is read-only by construction.
 *
 * The 8 services here cover all 10 nouns:
 *   course        -> CourseOperationsService
 *   version       -> VersionOperationsService
 *   section       -> LessonSectionOperationsService
 *   lesson        -> LessonSectionOperationsService
 *   video         -> VideoOperationsService
 *   clip          -> ClipOperationsService
 *   segment       -> SegmentOperationsService
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
  SegmentOperationsService.Default,
  PitchOperationsService.Default,
  DeliverableOperationsService.Default,
  SearchOperationsService.Default
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
