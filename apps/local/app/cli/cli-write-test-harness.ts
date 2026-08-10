import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import type { TestDb } from "@/test-utils/pglite";
import * as schema from "@/db/schema";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import {
  buildRemoteLayer,
  type RemoteHarnessOptions,
} from "./cli-remote-test-harness";

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

/**
 * Mirrors ./layer.ts: the verb groups that have moved to the deployed API are
 * provided over HTTP, the rest still in-process. When a group moves, it moves
 * in both files.
 */
export const buildWriteLayer = (
  db: TestDb,
  options: RemoteHarnessOptions = {}
) =>
  Layer.mergeAll(
    buildRemoteLayer(db, options),
    Layer.mergeAll(
      CourseOperationsService.Default,
      VersionOperationsService.Default,
      LessonSectionOperationsService.Default,
      VideoOperationsService.Default,
      ClipOperationsService.Default,
      BeatOperationsService.Default,
      PitchOperationsService.Default,
      DeliverableOperationsService.Default,
      CourseWriteService.Default
    ).pipe(Layer.provideMerge(Layer.succeed(DrizzleService, db as never)))
  );

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

/**
 * Point VIDEO_FILES_DIR at a fresh temp directory for the duration of a suite.
 *
 * `buildProgram` provides the REAL FileSystem, so without this any test that
 * exercises `cvm file` would write into the repo's own ./video-files.
 */
export const makeTempVideoFilesDir = (): {
  readonly dir: string;
  readonly cleanup: () => void;
} => {
  const previous = process.env.VIDEO_FILES_DIR;
  const dir = nodeFs.mkdtempSync(
    nodePath.join(os.tmpdir(), "cvm-video-files-")
  );
  process.env.VIDEO_FILES_DIR = dir;

  return {
    dir,
    cleanup: () => {
      nodeFs.rmSync(dir, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.VIDEO_FILES_DIR;
      } else {
        process.env.VIDEO_FILES_DIR = previous;
      }
    },
  };
};

export interface WriteSeed {
  draftSectionId: string;
  lessonId: string;
  lessonVideoId: string;
  lessonVideoLineageId: string;
  standaloneActiveId: string;
  standaloneActiveLineageId: string;
  standaloneArchivedId: string;
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
    .values({ name: "Alpha", slug: "alpha" })
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
    .values({ repoVersionId: draftVersion!.id, title: "01-intro", order: 1 })
    .returning();
  const [lesson] = await db
    .insert(schema.lessons)
    .values({
      sectionId: draftSection!.id,
      title: "Welcome",
      order: 1,
      authoringStatus: "done",
    })
    .returning();
  const [lessonVideo] = await db
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "intro.mp4",
      originalFootagePath: "footage.mp4",
    })
    .returning();
  const [standaloneActive] = await db
    .insert(schema.videos)
    .values({ title: "standalone-active.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [standaloneArchived] = await db
    .insert(schema.videos)
    .values({
      title: "standalone-archived.mp4",
      originalFootagePath: "f.mp4",
      archived: true,
    })
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
    lessonVideoLineageId: lessonVideo!.lineageId,
    standaloneActiveId: standaloneActive!.id,
    standaloneActiveLineageId: standaloneActive!.lineageId,
    standaloneArchivedId: standaloneArchived!.id,
    pitchActiveId: pitchActive!.id,
    pitchArchivedId: pitchArchived!.id,
  };
};
