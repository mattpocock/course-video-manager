import { Effect } from "effect";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server.js";
import { toSlug } from "./lesson-path-service.js";
import { createMoveOps } from "./course-write-move-ops.js";
export { CourseWriteError } from "./course-write-service.types.js";

export class CourseWriteService extends Effect.Service<CourseWriteService>()(
  "CourseWriteService",
  {
    effect: Effect.gen(function* () {
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const addSection = Effect.fn("addSection")(function* (
        repoVersionId: string,
        title: string,
        maxOrder: number = 0,
        opts?: { adjacentSectionId: string; position: "before" | "after" }
      ) {
        let sectionNumber = maxOrder + 1;

        if (opts) {
          const sections =
            yield* lessonSectionOps.getSectionsByRepoVersionId(repoVersionId);
          const adjIdx = sections.findIndex(
            (s) => s.id === opts.adjacentSectionId
          );
          if (adjIdx !== -1) {
            const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
            const shiftUpdates = sections
              .slice(idx)
              .map((s) => ({ id: s.id, order: s.order + 1 }));
            yield* lessonSectionOps.batchUpdateSectionOrders(shiftUpdates);
            sectionNumber = sections[idx]
              ? sections[idx]!.order
              : Math.max(...sections.map((s) => s.order)) + 1;
          }
        }

        const [newSection] = yield* lessonSectionOps.createSections({
          repoVersionId,
          sections: [
            {
              sectionPathWithNumber: title,
              sectionNumber,
            },
          ],
        });

        return { success: true, sectionId: newSection!.id };
      });

      const addLesson = Effect.fn("addLesson")(function* (
        sectionId: string,
        title: string,
        opts?: { adjacentLessonId?: string; position?: "before" | "after" }
      ) {
        const lessons =
          yield* lessonSectionOps.getLessonsBySectionId(sectionId);
        const maxOrder =
          lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) : 0;
        let insertOrder = maxOrder + 1;

        if (opts?.adjacentLessonId && opts?.position) {
          const adjIdx = lessons.findIndex(
            (l) => l.id === opts.adjacentLessonId
          );
          if (adjIdx !== -1) {
            const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
            const shiftUpdates = lessons
              .slice(idx)
              .map((l) => ({ id: l.id, order: l.order + 1 }));
            yield* lessonSectionOps.batchUpdateLessonOrders(shiftUpdates);
            insertOrder = lessons[idx] ? lessons[idx]!.order : maxOrder + 1;
          }
        }

        const [newLesson] = yield* lessonSectionOps.createLesson(sectionId, {
          title,
          order: insertOrder,
        });

        yield* lessonSectionOps.updateLesson(newLesson!.id, {
          authoringStatus: "todo",
        });

        return { success: true, lessonId: newLesson!.id };
      });

      const createLesson = Effect.fn("createLesson")(function* (
        sectionId: string,
        title: string,
        opts?: { adjacentLessonId?: string; position?: "before" | "after" }
      ) {
        const result = yield* addLesson(sectionId, title, opts);
        return {
          success: true,
          lessonId: result.lessonId,
          path: toSlug(title) || "untitled",
        };
      });

      const { moveToSection, moveLessonsToSection } =
        createMoveOps(lessonSectionOps);

      const renameSection = Effect.fn("renameSection")(function* (
        sectionId: string,
        newTitle: string
      ) {
        const section =
          yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);

        if (section.title === newTitle) {
          return { success: true, title: section.title };
        }

        yield* lessonSectionOps.updateSectionTitle(sectionId, newTitle);
        return { success: true, title: newTitle };
      });

      return {
        createLesson,
        renameSection,
        addSection,
        addLesson,
        moveToSection,
        moveLessonsToSection,
      };
    }),
    dependencies: [LessonSectionOperationsService.Default],
  }
) {}
