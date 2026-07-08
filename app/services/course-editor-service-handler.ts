/**
 * CourseEditorService Handler
 *
 * Processes CourseEditorEvents by delegating to CourseWriteService
 * (for structural operations) or LessonSectionOperationsService (for property updates).
 * Also provides the direct transport factory for testing.
 */

import { Effect } from "effect";
import { CourseWriteService } from "./course-write-service";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { BeatOperationsService } from "./db-beat-operations.server";
import {
  createCourseEditorService,
  type CourseEditorEvent,
  type CourseEditorService,
} from "./course-editor-service";

// ============================================================================
// Handler
// ============================================================================

export const handleCourseEditorEvent = Effect.fn("handleCourseEditorEvent")(
  function* (event: CourseEditorEvent) {
    const service = yield* CourseWriteService;
    const lessonSectionOps = yield* LessonSectionOperationsService;
    const beatOps = yield* BeatOperationsService;

    switch (event.type) {
      // --- Section events ---
      case "create-section": {
        return yield* service.addSection(
          event.repoVersionId,
          event.title,
          event.maxOrder,
          event.adjacentSectionId && event.position
            ? {
                adjacentSectionId: event.adjacentSectionId,
                position: event.position,
              }
            : undefined
        );
      }

      case "update-section-name": {
        const newTitle = event.title.trim() || "untitled";
        return yield* service.renameSection(event.sectionId, newTitle);
      }

      case "update-section-description": {
        yield* lessonSectionOps.getSectionWithHierarchyById(event.sectionId);
        yield* lessonSectionOps.updateSectionDescription(
          event.sectionId,
          event.description.trim()
        );
        return { success: true };
      }

      case "archive-section": {
        return yield* service.archiveSection(event.sectionId);
      }

      case "reorder-sections": {
        return yield* service.reorderSections(event.sectionIds);
      }

      // --- Lesson events ---
      case "add-lesson": {
        return yield* service.addLesson(event.sectionId, event.title, {
          adjacentLessonId: event.adjacentLessonId,
          position: event.position,
        });
      }

      case "create-real-lesson": {
        return yield* service.createLesson(event.sectionId, event.title, {
          adjacentLessonId: event.adjacentLessonId,
          position: event.position,
        });
      }

      case "update-lesson-name": {
        return yield* service.renameLesson(event.lessonId, event.newSlug);
      }

      case "update-lesson-title": {
        const lesson = yield* lessonSectionOps.getLessonWithHierarchyById(
          event.lessonId
        );
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          title: event.title.trim(),
          sectionId: lesson.sectionId,
        });
        return { success: true };
      }

      case "update-lesson-description": {
        yield* lessonSectionOps.getLessonWithHierarchyById(event.lessonId);
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          description: event.description.trim(),
        });
        return { success: true };
      }

      case "update-lesson-icon": {
        yield* lessonSectionOps.getLessonWithHierarchyById(event.lessonId);
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          icon: event.icon,
        });
        return { success: true };
      }

      case "update-lesson-priority": {
        yield* lessonSectionOps.getLessonWithHierarchyById(event.lessonId);
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          priority: event.priority,
        });
        return { success: true };
      }

      case "update-lesson-dependencies": {
        yield* lessonSectionOps.getLessonWithHierarchyById(event.lessonId);
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          dependencies: event.dependencies,
        });
        return { success: true };
      }

      case "delete-lesson": {
        return yield* service.deleteLesson(event.lessonId);
      }

      case "reorder-lessons": {
        return yield* service.reorderLessons(event.sectionId, event.lessonIds);
      }

      case "move-lesson-to-section": {
        return yield* service.moveToSection(
          event.lessonId,
          event.targetSectionId,
          event.beforeLessonId ?? null
        );
      }

      case "move-lessons-to-section": {
        return yield* service.moveLessonsToSection(
          event.lessonIds,
          event.targetSectionId,
          event.beforeLessonId ?? null
        );
      }

      case "set-lesson-authoring-status": {
        yield* lessonSectionOps.getLessonWithHierarchyById(event.lessonId);
        yield* lessonSectionOps.updateLesson(event.lessonId, {
          authoringStatus: event.status,
        });
        return { success: true };
      }

      // --- Beat events ---
      case "create-beat": {
        const beat = yield* beatOps.createBeat(
          event.videoId,
          event.kind,
          event.beforeBeatId ?? null,
          event.title?.trim() ?? ""
        );
        return { success: true, beatId: beat.id };
      }

      case "rename-beat": {
        yield* beatOps.renameBeat(event.beatId, event.title.trim());
        return { success: true };
      }

      case "update-beat-description": {
        yield* beatOps.setBeatDescription(event.beatId, event.description);
        return { success: true };
      }

      case "set-beat-kind": {
        yield* beatOps.setBeatKind(event.beatId, event.kind);
        return { success: true };
      }

      case "delete-beat": {
        yield* beatOps.deleteBeat(event.beatId);
        return { success: true };
      }

      case "move-beat": {
        yield* beatOps.moveBeat(
          event.beatId,
          event.targetVideoId,
          event.beforeBeatId ?? null
        );
        return { success: true };
      }

      default: {
        const _exhaustive: never = event;
        throw new Error(`Unknown event type: ${(_exhaustive as any).type}`);
      }
    }
  }
);

// ============================================================================
// Direct Transport Factory (for tests)
// ============================================================================

export function createDirectCourseEditorService(
  runtimePromise: (effect: Effect.Effect<any, any, any>) => Promise<any>
): CourseEditorService {
  const send = (event: CourseEditorEvent): Promise<unknown> => {
    return runtimePromise(handleCourseEditorEvent(event));
  };

  return createCourseEditorService(send);
}
