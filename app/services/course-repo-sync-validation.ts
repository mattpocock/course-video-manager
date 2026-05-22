import { Data, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import path from "node:path";
import { CourseOperationsService } from "./db-course-operations.server";
import { parseSectionPath } from "./section-path-service";

export class CourseRepoSyncError extends Data.TaggedError(
  "CourseRepoSyncError"
)<{
  cause: unknown;
  message: string;
}> {}

export class CourseRepoSyncValidationService extends Effect.Service<CourseRepoSyncValidationService>()(
  "CourseRepoSyncValidationService",
  {
    effect: Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const fs = yield* FileSystem.FileSystem;

      const validate = Effect.fn("validateRepoSync")(function* (opts: {
        repoPath: string | null;
      }) {
        // Scoped validation: callers must pass the repoPath of the course
        // they wrote to (or null for ghost courses). Full-course scans were
        // O(courses × sections × lessons) FS calls; on WSL2 each call costs
        // ~100ms+, so unscoped validation added 5+ seconds per write op.
        if (opts.repoPath === null) return; // ghost course — nothing to validate
        const scopedRepoPath = opts.repoPath;

        const allCourses = yield* courseOps.getCourses();
        const courses = allCourses.filter((c) => c.filePath === scopedRepoPath);
        const mismatches: string[] = [];

        for (const course of courses) {
          if (!course.filePath) continue; // ghost course — no filesystem to validate
          const repoPath = course.filePath;
          const repoExists = yield* fs.exists(repoPath);

          if (!repoExists) {
            mismatches.push(
              `Course repo directory missing on disk: ${repoPath}`
            );
            continue;
          }

          const courseData = yield* courseOps.getCourseWithSectionsById(
            course.id
          );

          // Only validate the latest version (versions are ordered newest-first).
          // The filesystem only represents one version's state at a time, so
          // older versions may have stale section paths that no longer match.
          const latestVersion = courseData.versions[0];
          if (!latestVersion) continue;

          {
            const version = latestVersion;
            for (const section of version.sections) {
              const parsed = parseSectionPath(section.path);
              if (!parsed) continue; // ghost section — no directory expected

              // Skip sections with no real lessons — they may not have a
              // directory on disk yet (e.g. ghost sections with numbered paths).
              const hasRealLessons = section.lessons.some(
                (l) => l.fsStatus === "real"
              );
              if (!hasRealLessons) continue;

              const sectionDir = path.join(repoPath!, section.path);
              const sectionExists = yield* fs.exists(sectionDir);

              if (!sectionExists) {
                mismatches.push(
                  `Section directory missing: ${section.path} (expected at ${sectionDir})`
                );
                continue;
              }

              // Read actual directories on disk to detect orphans
              const diskEntries = yield* fs
                .readDirectory(sectionDir)
                .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

              // Build set of expected lesson dir names for real lessons
              const expectedLessonDirs = new Set<string>();

              for (const lesson of section.lessons) {
                if (lesson.fsStatus === "ghost") continue;

                expectedLessonDirs.add(lesson.path);
                const lessonDir = path.join(sectionDir, lesson.path);
                const lessonExists = yield* fs.exists(lessonDir);

                if (!lessonExists) {
                  mismatches.push(
                    `Lesson directory missing: ${section.path}/${lesson.path} (expected at ${lessonDir})`
                  );
                }
              }

              // Check for orphan lesson directories on disk
              for (const entry of diskEntries) {
                // Skip non-numbered directories (not lesson dirs)
                if (!/^\d/.test(entry)) continue;
                // Skip temp directories from rename operations
                if (entry.startsWith("__")) continue;

                if (!expectedLessonDirs.has(entry)) {
                  mismatches.push(
                    `Orphan lesson directory on disk: ${section.path}/${entry} (not tracked in database)`
                  );
                }
              }
            }

            // Check for orphan section directories on disk
            const diskSections = yield* fs
              .readDirectory(repoPath)
              .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

            const expectedSectionDirs = new Set(
              version.sections
                .filter((s) => parseSectionPath(s.path) !== null)
                .map((s) => s.path)
            );

            for (const entry of diskSections) {
              if (!/^\d/.test(entry)) continue;
              if (entry.startsWith("__")) continue;

              if (!expectedSectionDirs.has(entry)) {
                mismatches.push(
                  `Orphan section directory on disk: ${entry} (not tracked in database)`
                );
              }
            }
          }
        }

        if (mismatches.length > 0) {
          return yield* new CourseRepoSyncError({
            cause: null,
            message: `Course repo out of sync with filesystem:\n${mismatches.join("\n")}`,
          });
        }
      });

      return { validate };
    }),
    dependencies: [NodeFileSystem.layer, CourseOperationsService.Default],
  }
) {}
