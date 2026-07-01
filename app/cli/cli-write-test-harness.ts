import { Effect, Layer } from "effect";
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
import type { TestDb } from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";

/**
 * Shared harness for the `cvm` WRITE-verb integration tests. Mirrors the layer
 * + run() plumbing of cli-integration.test.ts, but lives in its own module so
 * the write-verb suites can be split across small test files (the main
 * integration test file is already at the repo's per-file token budget). Same
 * contract: run the REAL buildProgram over PGlite with a captured CliOutput,
 * asserting { stdout, stderr, exitCode } — no subprocess.
 */
export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const buildWriteLayer = (db: TestDb) =>
  Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    VideoOperationsService.Default,
    ClipOperationsService.Default,
    SegmentOperationsService.Default,
    PitchOperationsService.Default,
    DeliverableOperationsService.Default,
    SearchOperationsService.Default
  ).pipe(Layer.provideMerge(Layer.succeed(DrizzleService, db as never)));

/** A run() bound to a specific captured-output layer. */
export const makeRun =
  (layer: ReturnType<typeof buildWriteLayer>) =>
  async (argv: ReadonlyArray<string>): Promise<RunResult> => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };

/** Parse NDJSON stdout into an array of objects (one per non-empty line). */
export const ndjson = (stdout: string): unknown[] =>
  stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

/** Parse a write verb's single pretty-printed JSON object. */
export const one = <T = Record<string, unknown>>(stdout: string): T =>
  JSON.parse(stdout) as T;

export interface WriteSeed {
  draftSectionId: string;
  lessonId: string;
  lessonVideoId: string;
  standaloneActiveId: string;
  pitchActiveId: string;
  pitchArchivedId: string;
}

/**
 * Minimal fixture for the write-verb suites: one course → draft version →
 * section → lesson → lesson-bound video, plus a standalone video and an active
 * + archived pitch. Enough to exercise every create/move/update/link path.
 */
export const seedWrite = async (db: TestDb): Promise<WriteSeed> => {
  const [course] = await db
    .insert(schema.courses)
    .values({ name: "Alpha", slug: "alpha", filePath: "/tmp/alpha" })
    .returning();
  const [draftVersion] = await db
    .insert(schema.courseVersions)
    .values({
      repoId: course!.id,
      name: "",
      createdAt: new Date("2024-01-01T00:00:00Z"),
    })
    .returning();
  const [draftSection] = await db
    .insert(schema.sections)
    .values({ repoVersionId: draftVersion!.id, path: "01-intro", order: 1 })
    .returning();
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      path: "01-welcome",
      title: "Welcome",
      order: 1,
      fsStatus: "real",
      authoringStatus: "done",
    })
    .returning();
  const [lessonVideo] = await db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      path: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();
  const [standaloneActive] = await db
    .insert(schema.videos)
    .values({ path: "standalone-active.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [pitchActive] = await db
    .insert(schema.pitches)
    .values({ title: "Active pitch" })
    .returning();
  const [pitchArchived] = await db
    .insert(schema.pitches)
    .values({ title: "Archived pitch", archived: true })
    .returning();

  return {
    draftSectionId: draftSection!.id,
    lessonId: lesson!.id,
    lessonVideoId: lessonVideo!.id,
    standaloneActiveId: standaloneActive!.id,
    pitchActiveId: pitchActive!.id,
    pitchArchivedId: pitchArchived!.id,
  };
};
