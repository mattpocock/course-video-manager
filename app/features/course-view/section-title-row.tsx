import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  useSectionTitleEditor,
  SectionTitleEditor,
} from "./section-title-editor";

export function SectionTitleRow({
  section,
  showGhostStyle,
  isReadOnly,
  editSectionId,
  dispatch,
  submitEvent,
  navigateTo,
}: {
  section: { id: string; title: string };
  showGhostStyle: boolean;
  isReadOnly: boolean;
  editSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  /** When set, the header navigates to the Section Workbench (see editor). */
  navigateTo?: string;
}) {
  const {
    editingTitle,
    titleValue,
    setTitleValue,
    saveTitle,
    cancelEditing,
    startEditingTitle,
  } = useSectionTitleEditor({
    sectionId: section.id,
    sectionTitle: section.title,
    dispatch,
    submitEvent,
    editSectionId,
  });

  return (
    <SectionTitleEditor
      sectionTitle={section.title}
      showGhostStyle={showGhostStyle}
      isReadOnly={isReadOnly}
      editingTitle={editingTitle}
      titleValue={titleValue}
      onTitleValueChange={setTitleValue}
      onCancel={cancelEditing}
      onSave={saveTitle}
      onStartEditing={startEditingTitle}
      navigateTo={navigateTo}
    />
  );
}
