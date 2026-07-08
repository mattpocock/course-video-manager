import { Effect } from "effect";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { toSlug } from "./lesson-path-service";
import { createMoveOps } from "./course-write-move-ops";
export { CourseWriteError } from "./course-write-service.types";

export class CourseWriteService extends Effect.Service<CourseWriteService>()(
  "CourseWriteService",
  {
    effect: Effect.gen(function* () {
      const lessonSectionOps = yield* LessonSectionOperationsService;

      const addGhostSection = Effect.fn("addGhostSection")(function* (
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

      const addGhostLesson = Effect.fn("addGhostLesson")(function* (
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

        const [newLesson] = yield* lessonSectionOps.createGhostLesson(
          sectionId,
          {
            title,
            order: insertOrder,
          }
        );

        yield* lessonSectionOps.updateLesson(newLesson!.id, {
          authoringStatus: "todo",
        });

        return { success: true, lessonId: newLesson!.id };
      });

      const createRealLesson = Effect.fn("createRealLesson")(function* (
        sectionId: string,
        title: string,
        opts?: { adjacentLessonId?: string; position?: "before" | "after" }
      ) {
        const result = yield* addGhostLesson(sectionId, title, opts);
        return {
          success: true,
          lessonId: result.lessonId,
          path: toSlug(title) || "untitled",
        };
      });

      const deleteLesson = Effect.fn("deleteLesson")(function* (
        lessonId: string
      ) {
        yield* lessonSectionOps.deleteLesson(lessonId);
        return { success: true };
      });

      const renameLesson = Effect.fn("renameLesson")(function* (
        lessonId: string,
        newSlug: string
      ) {
        yield* lessonSectionOps.updateLesson(lessonId, {
          title: newSlug,
        });
        return { success: true, title: newSlug };
      });

      const reorderLessons = Effect.fn("reorderLessons")(function* (
        _sectionId: string,
        newOrderIds: readonly string[]
      ) {
        yield* lessonSectionOps.batchUpdateLessonOrders(
          newOrderIds.map((id, i) => ({ id, order: i }))
        );
        return { success: true, renames: [] };
      });

      const { moveToSection, moveLessonsToSection } =
        createMoveOps(lessonSectionOps);

      const archiveSection = Effect.fn("archiveSection")(function* (
        sectionId: string
      ) {
        yield* lessonSectionOps.archiveSection(sectionId);
        return { success: true };
      });

      const reorderSections = Effect.fn("reorderSections")(function* (
        sectionIds: readonly string[]
      ) {
        yield* lessonSectionOps.batchUpdateSectionOrders(
          sectionIds.map((id, i) => ({ id, order: i }))
        );
        return { success: true };
      });

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
        createRealLesson,
        reorderLessons,
        reorderSections,
        renameSection,
        archiveSection,
        addGhostSection,
        addGhostLesson,
        deleteLesson,
        renameLesson,
        moveToSection,
        moveLessonsToSection,
      };
    }),
    dependencies: [LessonSectionOperationsService.Default],
  }
) {}
