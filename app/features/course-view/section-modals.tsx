import { AddGhostLessonModal } from "@/components/add-ghost-lesson-modal";
import { ArchiveSectionModal } from "@/components/archive-section-modal";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";

export function SectionModals({
  sectionId,
  sectionPath,
  lessonCount,
  addGhostLessonSectionId,
  insertAdjacentLessonId,
  insertPosition,
  archiveSectionId,
  courseFilePath,
  dispatch,
  submitEvent,
}: {
  sectionId: string;
  sectionPath: string;
  lessonCount: number;
  addGhostLessonSectionId: string | null;
  insertAdjacentLessonId: string | null;
  insertPosition: "before" | "after" | null;
  archiveSectionId: string | null;
  courseFilePath: string | null;
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
        onAddLesson={({ title, isReal }) => {
          submitEvent({
            type: isReal ? "create-real-lesson" : "add-ghost-lesson",
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
        courseFilePath={courseFilePath}
      />
      <ArchiveSectionModal
        sectionId={sectionId}
        sectionTitle={sectionPath}
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
