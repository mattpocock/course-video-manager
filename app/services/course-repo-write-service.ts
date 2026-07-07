import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Data, Effect } from "effect";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { buildLessonPath, parseLessonPath } from "./lesson-path-service";

/**
 * Title-cases a dash-case slug for a new lesson's readme stub heading when no
 * explicit title is supplied. Local to this file — the shared lossy slug→title
 * helper is deleted from the authoring model; callers pass the real title.
 */
const titleCaseFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export class CourseRepoWriteError extends Data.TaggedError(
  "CourseRepoWriteError"
)<{
  cause: unknown;
  message: string;
}> {}

export class CourseRepoWriteService extends Effect.Service<CourseRepoWriteService>()(
  "CourseRepoWriteService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      /**
       * Creates a lesson directory with an `explainer/readme.md` stub.
       *
       * @param repoPath - Absolute path to the course repo root
       * @param sectionPath - Section directory name (e.g., "01-intro")
       * @param lessonDirName - Full lesson directory name (e.g., "01.03-my-lesson")
       */
      const createLessonDirectory = Effect.fn("createLessonDirectory")(
        function* (opts: {
          repoPath: string;
          sectionPath: string;
          lessonDirName: string;
          /** Human title for the readme heading; falls back to the slug. */
          title?: string;
        }) {
          const explainerDir = path.join(
            opts.repoPath,
            opts.sectionPath,
            opts.lessonDirName,
            "explainer"
          );
          const readmePath = path.join(explainerDir, "readme.md");

          const parsed = parseLessonPath(opts.lessonDirName);
          const heading =
            opts.title && opts.title.trim() !== ""
              ? opts.title
              : titleCaseFromSlug(parsed?.slug ?? opts.lessonDirName);

          yield* fs.makeDirectory(explainerDir, { recursive: true });
          yield* fs.writeFileString(readmePath, `# ${heading}\n`);

          // Stage the new files so subsequent git operations (mv, rm) work
          const lessonFullPath = path.join(
            opts.repoPath,
            opts.sectionPath,
            opts.lessonDirName
          );
          yield* Effect.try({
            try: () =>
              execFileSync("git", ["add", lessonFullPath], {
                cwd: opts.repoPath,
              }),
            catch: (cause) =>
              new CourseRepoWriteError({
                cause,
                message: `git add failed: ${opts.sectionPath}/${opts.lessonDirName}`,
              }),
          });
        }
      );

      /**
       * Adds a new lesson to a section, appended at the end.
       * Reads the section directory to determine the next lesson number,
       * then creates the directory structure.
       *
       * @param repoPath - Absolute path to the course repo root
       * @param sectionPath - Section directory name (e.g., "01-intro")
       * @param sectionNumber - The section's number (for building XX.YY format)
       * @param slug - The lesson slug (e.g., "my-lesson")
       * @returns The created lesson directory name and lesson number
       */
      const addLesson = Effect.fn("addLesson")(function* (opts: {
        repoPath: string;
        sectionPath: string;
        sectionNumber: number;
        slug: string;
      }) {
        const sectionDir = path.join(opts.repoPath, opts.sectionPath);

        const entries = yield* fs
          .readDirectory(sectionDir)
          .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

        let maxLessonNumber = 0;
        for (const entry of entries) {
          const parsed = parseLessonPath(entry);
          if (parsed) {
            maxLessonNumber = Math.max(maxLessonNumber, parsed.lessonNumber);
          }
        }

        const nextLessonNumber = maxLessonNumber + 1;
        const lessonDirName = buildLessonPath(
          opts.sectionNumber,
          nextLessonNumber,
          opts.slug
        );

        yield* createLessonDirectory({
          repoPath: opts.repoPath,
          sectionPath: opts.sectionPath,
          lessonDirName,
        });

        return { lessonDirName, lessonNumber: nextLessonNumber };
      });

      /**
       * Renames a lesson directory by changing only its slug portion.
       * Uses `git mv` to preserve git history.
       *
       * @param repoPath - Absolute path to the course repo root
       * @param sectionPath - Section directory name (e.g., "01-intro")
       * @param oldLessonDirName - Current lesson directory name (e.g., "01.03-old-name")
       * @param newSlug - The new slug (e.g., "new-name")
       * @returns The new lesson directory name
       */
      const renameLesson = Effect.fn("renameLesson")(function* (opts: {
        repoPath: string;
        sectionPath: string;
        oldLessonDirName: string;
        newSlug: string;
      }) {
        const parsed = parseLessonPath(opts.oldLessonDirName);
        if (!parsed) {
          return yield* new CourseRepoWriteError({
            cause: null,
            message: `Cannot parse lesson path: ${opts.oldLessonDirName}`,
          });
        }

        const sectionNumber = parsed.sectionNumber ?? 1;
        const newLessonDirName = buildLessonPath(
          sectionNumber,
          parsed.lessonNumber,
          opts.newSlug
        );

        if (newLessonDirName === opts.oldLessonDirName) {
          return { newLessonDirName };
        }

        const oldFullPath = path.join(
          opts.repoPath,
          opts.sectionPath,
          opts.oldLessonDirName
        );
        const newFullPath = path.join(
          opts.repoPath,
          opts.sectionPath,
          newLessonDirName
        );

        yield* Effect.try({
          try: () =>
            execFileSync("git", ["mv", oldFullPath, newFullPath], {
              cwd: opts.repoPath,
            }),
          catch: (cause) =>
            new CourseRepoWriteError({
              cause,
              message: `git mv failed: ${opts.oldLessonDirName} → ${newLessonDirName}`,
            }),
        });

        return { newLessonDirName };
      });

      /**
       * Executes a batch of `git mv` operations for reordering lessons.
       * Uses a two-pass rename (old → temp, temp → final) to avoid path collisions.
       *
       * @param repoPath - Absolute path to the course repo root
       * @param sectionPath - Section directory name (e.g., "01-intro")
       * @param renames - Array of {oldPath, newPath} rename operations
       */
      const renameLessons = Effect.fn("renameLessons")(function* (opts: {
        repoPath: string;
        sectionPath: string;
        renames: Array<{ oldPath: string; newPath: string }>;
      }) {
        if (opts.renames.length === 0) return;

        const tempPrefix = `__reorder_tmp_`;
        const sectionFullPath = path.join(opts.repoPath, opts.sectionPath);

        // Clean up any leftover temp dirs from a previous failed rename
        const existingEntries = yield* fs
          .readDirectory(sectionFullPath)
          .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

        for (const entry of existingEntries) {
          if (entry.startsWith(tempPrefix)) {
            const tempFullPath = path.join(sectionFullPath, entry);
            // Try git rm first, fall back to plain removal
            yield* Effect.try({
              try: () =>
                execFileSync("git", ["rm", "-rf", tempFullPath], {
                  cwd: opts.repoPath,
                }),
              catch: () =>
                new CourseRepoWriteError({
                  cause: null,
                  message: `cleanup git rm failed: ${entry}`,
                }),
            }).pipe(
              Effect.catchAll(() =>
                fs.remove(tempFullPath, { recursive: true })
              )
            );
          }
        }

        // Pass 1: old → temp (avoids collisions)
        const completedPass1: number[] = [];
        const pass1 = Effect.forEach(
          opts.renames,
          (rename, i) => {
            const tempName = `${tempPrefix}${i}_${rename.newPath}`;
            const oldFullPath = path.join(sectionFullPath, rename.oldPath);
            const tempFullPath = path.join(sectionFullPath, tempName);

            return Effect.try({
              try: () => {
                execFileSync("git", ["mv", oldFullPath, tempFullPath], {
                  cwd: opts.repoPath,
                });
                completedPass1.push(i);
              },
              catch: (cause) =>
                new CourseRepoWriteError({
                  cause,
                  message: `git mv failed (pass 1): ${rename.oldPath} → ${tempName}`,
                }),
            });
          },
          { concurrency: 1 }
        );

        // If pass 1 fails, rollback completed entries (temp → old)
        yield* pass1.pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              for (const i of completedPass1) {
                const rename = opts.renames[i]!;
                const tempName = `${tempPrefix}${i}_${rename.newPath}`;
                const tempFullPath = path.join(sectionFullPath, tempName);
                const oldFullPath = path.join(sectionFullPath, rename.oldPath);

                yield* Effect.try({
                  try: () =>
                    execFileSync("git", ["mv", tempFullPath, oldFullPath], {
                      cwd: opts.repoPath,
                    }),
                  catch: () =>
                    new CourseRepoWriteError({
                      cause: null,
                      message: `rollback git mv failed: ${tempName} → ${rename.oldPath}`,
                    }),
                }).pipe(Effect.catchAll(() => Effect.void));
              }
              return yield* new CourseRepoWriteError({
                cause: error,
                message: error.message,
              });
            })
          )
        );

        // Pass 2: temp → final
        for (let i = 0; i < opts.renames.length; i++) {
          const rename = opts.renames[i]!;
          const tempName = `${tempPrefix}${i}_${rename.newPath}`;
          const tempFullPath = path.join(sectionFullPath, tempName);
          const newFullPath = path.join(sectionFullPath, rename.newPath);

          yield* Effect.try({
            try: () =>
              execFileSync("git", ["mv", tempFullPath, newFullPath], {
                cwd: opts.repoPath,
              }),
            catch: (cause) =>
              new CourseRepoWriteError({
                cause,
                message: `git mv failed (pass 2): ${tempName} → ${rename.newPath}`,
              }),
          });
        }
      });

      /**
       * Executes a batch of `git mv` operations for reordering sections.
       * Uses a two-pass rename (old → temp, temp → final) to avoid path collisions.
       *
       * @param repoPath - Absolute path to the course repo root
       * @param renames - Array of {oldPath, newPath} rename operations for section directories
       */
      const renameSections = Effect.fn("renameSections")(function* (opts: {
        repoPath: string;
        renames: Array<{ oldPath: string; newPath: string }>;
      }) {
        if (opts.renames.length === 0) return;

        const tempPrefix = `__section_reorder_tmp_`;

        // Clean up any leftover temp dirs from a previous failed rename
        const existingEntries = yield* fs
          .readDirectory(opts.repoPath)
          .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

        for (const entry of existingEntries) {
          if (entry.startsWith(tempPrefix)) {
            const tempFullPath = path.join(opts.repoPath, entry);
            yield* Effect.try({
              try: () =>
                execFileSync("git", ["rm", "-rf", tempFullPath], {
                  cwd: opts.repoPath,
                }),
              catch: () =>
                new CourseRepoWriteError({
                  cause: null,
                  message: `cleanup git rm failed: ${entry}`,
                }),
            }).pipe(
              Effect.catchAll(() =>
                fs.remove(tempFullPath, { recursive: true })
              )
            );
          }
        }

        // Pass 1: old → temp (avoids collisions)
        const completedPass1: number[] = [];
        const pass1 = Effect.forEach(
          opts.renames,
          (rename, i) => {
            const tempName = `${tempPrefix}${i}_${rename.newPath}`;
            const oldFullPath = path.join(opts.repoPath, rename.oldPath);
            const tempFullPath = path.join(opts.repoPath, tempName);

            return Effect.try({
              try: () => {
                execFileSync("git", ["mv", oldFullPath, tempFullPath], {
                  cwd: opts.repoPath,
                });
                completedPass1.push(i);
              },
              catch: (cause) =>
                new CourseRepoWriteError({
                  cause,
                  message: `git mv failed (pass 1): ${rename.oldPath} → ${tempName}`,
                }),
            });
          },
          { concurrency: 1 }
        );

        // If pass 1 fails, rollback completed entries (temp → old)
        yield* pass1.pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              for (const i of completedPass1) {
                const rename = opts.renames[i]!;
                const tempName = `${tempPrefix}${i}_${rename.newPath}`;
                const tempFullPath = path.join(opts.repoPath, tempName);
                const oldFullPath = path.join(opts.repoPath, rename.oldPath);

                yield* Effect.try({
                  try: () =>
                    execFileSync("git", ["mv", tempFullPath, oldFullPath], {
                      cwd: opts.repoPath,
                    }),
                  catch: () =>
                    new CourseRepoWriteError({
                      cause: null,
                      message: `rollback git mv failed: ${tempName} → ${rename.oldPath}`,
                    }),
                }).pipe(Effect.catchAll(() => Effect.void));
              }
              return yield* new CourseRepoWriteError({
                cause: error,
                message: error.message,
              });
            })
          )
        );

        // Pass 2: temp → final
        for (let i = 0; i < opts.renames.length; i++) {
          const rename = opts.renames[i]!;
          const tempName = `${tempPrefix}${i}_${rename.newPath}`;
          const tempFullPath = path.join(opts.repoPath, tempName);
          const newFullPath = path.join(opts.repoPath, rename.newPath);

          yield* Effect.try({
            try: () =>
              execFileSync("git", ["mv", tempFullPath, newFullPath], {
                cwd: opts.repoPath,
              }),
            catch: (cause) =>
              new CourseRepoWriteError({
                cause,
                message: `git mv failed (pass 2): ${tempName} → ${rename.newPath}`,
              }),
          });
        }
      });

      /**
       * Deletes a lesson directory from the filesystem.
       * Uses `git rm -rf` for tracked files; falls back to recursive
       * removal for untracked directories (e.g. newly added, never committed).
       */
      const deleteLesson = Effect.fn("deleteLesson")(function* (opts: {
        repoPath: string;
        sectionPath: string;
        lessonDirName: string;
      }) {
        const fullPath = path.join(
          opts.repoPath,
          opts.sectionPath,
          opts.lessonDirName
        );

        // Check if the directory exists at all
        const exists = yield* fs.exists(fullPath);
        if (!exists) return;

        // Try git rm -rf first (works for tracked files, stages the deletion)
        const gitRmSucceeded = yield* Effect.try({
          try: () => {
            execFileSync("git", ["rm", "-rf", fullPath], {
              cwd: opts.repoPath,
            });
            return true;
          },
          catch: () =>
            new CourseRepoWriteError({
              cause: null,
              message: "git rm failed",
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

        if (gitRmSucceeded) return;

        // Fallback: plain recursive removal for untracked directories
        yield* fs.remove(fullPath, { recursive: true });
      });

      /**
       * Moves a lesson directory from one section to another via `git mv`.
       */
      const moveLessonToSection = Effect.fn("moveLessonToSection")(
        function* (opts: {
          repoPath: string;
          sourceSectionPath: string;
          targetSectionPath: string;
          oldLessonDirName: string;
          newLessonDirName: string;
        }) {
          const oldFullPath = path.join(
            opts.repoPath,
            opts.sourceSectionPath,
            opts.oldLessonDirName
          );
          const newFullPath = path.join(
            opts.repoPath,
            opts.targetSectionPath,
            opts.newLessonDirName
          );

          yield* Effect.try({
            try: () =>
              execFileSync("git", ["mv", oldFullPath, newFullPath], {
                cwd: opts.repoPath,
              }),
            catch: (cause) =>
              new CourseRepoWriteError({
                cause,
                message: `git mv failed: ${opts.sourceSectionPath}/${opts.oldLessonDirName} → ${opts.targetSectionPath}/${opts.newLessonDirName}`,
              }),
          });
        }
      );

      /**
       * Checks whether a section directory exists on the filesystem.
       */
      const sectionDirExists = Effect.fn("sectionDirExists")(function* (opts: {
        repoPath: string;
        sectionPath: string;
      }) {
        const fullPath = path.join(opts.repoPath, opts.sectionPath);
        return yield* fs.exists(fullPath);
      });

      /**
       * Deletes a section directory from the filesystem.
       * Uses `git rm -rf` for tracked files; falls back to recursive
       * removal for untracked directories.
       */
      const deleteSectionDir = Effect.fn("deleteSectionDir")(function* (opts: {
        repoPath: string;
        sectionPath: string;
      }) {
        const fullPath = path.join(opts.repoPath, opts.sectionPath);

        const exists = yield* fs.exists(fullPath);
        if (!exists) return;

        const gitRmSucceeded = yield* Effect.try({
          try: () => {
            execFileSync("git", ["rm", "-rf", fullPath], {
              cwd: opts.repoPath,
            });
            return true;
          },
          catch: () =>
            new CourseRepoWriteError({
              cause: null,
              message: "git rm failed",
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

        if (gitRmSucceeded) return;

        yield* fs.remove(fullPath, { recursive: true });
      });

      return {
        createLessonDirectory,
        addLesson,
        renameLesson,
        renameLessons,
        renameSections,
        deleteLesson,
        moveLessonToSection,
        sectionDirExists,
        deleteSectionDir,
      };
    }),
    dependencies: [NodeFileSystem.layer],
  }
) {}
