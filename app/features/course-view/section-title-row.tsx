import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  useSectionTitleEditor,
  SectionTitleEditor,
} from "./section-title-editor";

export function SectionTitleRow({
  section,
  isGhostSection,
  showGhostStyle,
  isReadOnly,
  editSectionId,
  dispatch,
  submitEvent,
  navigateTo,
}: {
  section: { id: string; path: string };
  isGhostSection: boolean;
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
    pathPrefix,
  } = useSectionTitleEditor({
    sectionId: section.id,
    sectionPath: section.path,
    isGhostSection,
    dispatch,
    submitEvent,
    editSectionId,
  });

  return (
    <SectionTitleEditor
      sectionPath={section.path}
      isGhostSection={isGhostSection}
      showGhostStyle={showGhostStyle}
      isReadOnly={isReadOnly}
      editingTitle={editingTitle}
      titleValue={titleValue}
      pathPrefix={pathPrefix}
      onTitleValueChange={setTitleValue}
      onCancel={cancelEditing}
      onSave={saveTitle}
      onStartEditing={startEditingTitle}
      navigateTo={navigateTo}
    />
  );
}
