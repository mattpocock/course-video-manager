import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LearningGoalOperationsService } from "@/services/db-learning-goal-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import {
  computeSectionLint,
  type SectionLintLesson,
  type SectionLintVideo,
} from "@/services/section-lint";
import { detail, emitObject, notFound } from "@/cli/helpers";
import { LINT_HELP } from "./section.help";

/**
 * `cvm section lint <sectionId>` — the section-authoring quality bar, enforced.
 *
 * Gathers one Section's planning tree (its Learning Goals, and the Beats of
 * every Video of every active Lesson) and hands it to the pure
 * `computeSectionLint`. The checks, their exemptions and the reason a finding
 * is NOT a non-zero exit all live there; this file is transport only.
 *
 * Unlike `course readiness` — its nearest relative in output shape — this needs
 * no filesystem, so it is NOT local-only: it runs over the same HTTP transport
 * as every other read, which is the point, because the agent that wants it runs
 * on a Remote Box.
 */

const sectionId = Args.text({ name: "sectionId" });

export const sectionLintCmd = Command.make(
  "lint",
  { sectionId },
  ({ sectionId }) =>
    Effect.gen(function* () {
      const sections = yield* LessonSectionOperationsService;
      const goals = yield* LearningGoalOperationsService;
      const beatOps = yield* BeatOperationsService;

      const section = yield* sections
        .getSectionWithHierarchyById(sectionId)
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
        );
      // An archived Section is deleted-equivalent everywhere in this CLI, so it
      // is a not-found (exit 2) rather than a clean lint of nothing.
      if (section === undefined || section.archivedAt !== null) {
        return yield* notFound("section", sectionId);
      }

      const learningGoals =
        yield* goals.listLearningGoalsBySectionId(sectionId);

      const lessonRows = yield* sections.getLessonsBySectionId(sectionId);
      const lessons: ReadonlyArray<SectionLintLesson> = yield* Effect.forEach(
        lessonRows,
        (lesson) =>
          Effect.gen(function* () {
            const full = yield* sections
              .getLessonById(lesson.id)
              .pipe(
                Effect.catchTag("NotFoundError", () =>
                  Effect.succeed(undefined)
                )
              );
            const videoRows = (full?.videos ?? []).filter((v) => !v.archived);
            const videos: ReadonlyArray<SectionLintVideo> =
              yield* Effect.forEach(videoRows, (video) =>
                beatOps.listBeatsByVideoId(video.id).pipe(
                  Effect.map((beats) => ({
                    id: video.id,
                    title: video.title,
                    beats,
                  }))
                )
              );
            return { id: lesson.id, title: lesson.title, videos };
          })
      );

      yield* emitObject(
        computeSectionLint({
          sectionId: section.id,
          sectionTitle: section.title,
          learningGoals,
          lessons,
        })
      );
    })
).pipe(Command.withDescription(detail(LINT_HELP)));
