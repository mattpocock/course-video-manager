import { AddGhostLessonModal } from "@/components/add-ghost-lesson-modal";
import { ArchiveSectionModal } from "@/components/archive-section-modal";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";

export function SectionModals({
  sectionId,
  sectionTitle,
  lessonCount,
  addGhostLessonSectionId,
  insertAdjacentLessonId,
  insertPosition,
  archiveSectionId,
  dispatch,
  submitEvent,
}: {
  sectionId: string;
  sectionTitle: string;
  lessonCount: number;
  addGhostLessonSectionId: string | null;
  insertAdjacentLessonId: string | null;
  insertPosition: "before" | "after" | null;
  archiveSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  return (
    <>
      <AddGhostLessonModal
        sectionId={sectionId}
        open={addGhostLessonSectionId === sectionId}
        onOpenChange={(open) => {
          dispatch({
            type: "set-add-lesson-section-id",
            sectionId: open ? sectionId : null,
          });
        }}
        onAddLesson={({ title }) => {
          submitEvent({
            type: "add-ghost-lesson",
            sectionId,
            title,
            ...(insertAdjacentLessonId
              ? {
                  adjacentLessonId: insertAdjacentLessonId,
                  position: insertPosition ?? undefined,
                }
              : {}),
          });
        }}
        adjacentLessonId={insertAdjacentLessonId}
        position={insertPosition}
      />
      <ArchiveSectionModal
        sectionId={sectionId}
        sectionTitle={sectionTitle}
        lessonCount={lessonCount}
        open={archiveSectionId === sectionId}
        onOpenChange={(open) => {
          dispatch({
            type: "set-archive-section-id",
            sectionId: open ? sectionId : null,
          });
        }}
        onArchive={() => {
          submitEvent({
            type: "archive-section",
            sectionId,
          });
        }}
      />
    </>
  );
}
