import { type DependencyLessonItem } from "@/components/dependency-selector";
import { SectionModals } from "./section-modals";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { SortableLessonItem } from "./sortable-lesson-item";
import { SortableSectionItem } from "./sortable-section-item";
import { SectionDescriptionEditor } from "./section-description-editor";
import { SectionTitleRow } from "./section-title-row";
import { SectionContextMenuItems } from "./section-context-menu";
import {
  filterLessons,
  calcSectionDuration,
  computeSectionDependencyRuns,
} from "./section-grid-utils";
import { CompactLessonList, runSpacingClass } from "./dep-group-spine";
import { type LoaderData } from "./course-view-types";
import { formatSecondsToTimeCode } from "@/services/utils";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { useLessonDrag } from "./use-lesson-drag";
import { ChevronRight, Ghost, GripVertical } from "lucide-react";
import { Fragment } from "react";
import type { useNavigate, useFetcher } from "react-router";

/** Insertion indicator shown at the drop anchor during a cross-section drag. */
function DropLine() {
  return <div className="h-0.5 my-0.5 rounded-full bg-primary" />;
}

type LessonDragState = ReturnType<typeof useLessonDrag>;

export function SectionCard({
  section,
  currentCourse,
  data,
  priorityFilter,
  iconFilter,
  fsStatusFilter,
  searchQuery,
  viewMode,
  addGhostLessonSectionId,
  insertAdjacentLessonId,
  insertPosition,
  editSectionId,
  addVideoToLessonId,
  convertToGhostLessonId,
  deleteLessonId,
  createOnDiskLessonId,
  editDescriptionLessonId,
  archiveSectionId,
  collapsedSections,
  toggleSection,
  lessonSelection,
  dispatch,
  submitEvent,
  navigate,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
  isGhostCourse,
  isReadOnly,
  allSectionIds,
  allFlatLessons,
  dependencyMap,
  dropIndicator,
  activeLesson,
  bulkDragIds,
}: {
  section: NonNullable<LoaderData["selectedCourse"]>["sections"][number];
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
  data: LoaderData;
  isGhostCourse: boolean;
  isReadOnly: boolean;
  viewMode: "expanded" | "compact";
  priorityFilter: number[];
  iconFilter: string[];
  fsStatusFilter: string | null;
  searchQuery: string;
  addGhostLessonSectionId: string | null;
  insertAdjacentLessonId: string | null;
  insertPosition: "before" | "after" | null;
  editSectionId: string | null;
  addVideoToLessonId: string | null;
  convertToGhostLessonId: string | null;
  deleteLessonId: string | null;
  createOnDiskLessonId: string | null;
  editDescriptionLessonId: string | null;
  archiveSectionId: string | null;
  collapsedSections: Set<string>;
  toggleSection: (sectionId: string) => void;
  lessonSelection: courseViewReducer.LessonSelection;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  navigate: ReturnType<typeof useNavigate>;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
  allSectionIds: string[];
  allFlatLessons: DependencyLessonItem[];
  dependencyMap: Record<string, string[]>;
  dropIndicator: LessonDragState["dropIndicator"];
  activeLesson: LessonDragState["activeLesson"];
  bulkDragIds: LessonDragState["bulkDragIds"];
}) {
  const lessons = section.lessons;

  const { filteredLessons, hasActiveFilters } = filterLessons(lessons, {
    priorityFilter,
    iconFilter,
    fsStatusFilter,
    searchQuery,
  });

  const sectionDuration = calcSectionDuration(lessons);

  // Dependency Group runs + spine pairs. Only in compact view, and
  // suppressed under any active filter (the rendered list no longer
  // reflects true adjacency). See CONTEXT.md / docs/adr/0010.
  const { runs, spinePairs, revalidateKey } = computeSectionDependencyRuns(
    lessons,
    filteredLessons,
    viewMode === "compact" && !hasActiveFilters
  );

  const isGhostSection =
    lessons.length === 0 || lessons.every((l) => l.fsStatus === "ghost");
  const showGhostSectionStyle = isGhostSection && !isGhostCourse;

  return (
    <SortableSectionItem
      key={section.id}
      id={section.id}
      compact={viewMode === "compact"}
    >
      {(dragHandleListeners) => (
        <>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="cursor-context-menu">
                <div
                  className={cn(
                    viewMode !== "compact" && "border-b bg-muted/30"
                  )}
                >
                  <div
                    className={
                      viewMode === "compact" ? "px-2 py-1" : "px-4 py-3"
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {!isReadOnly && (
                          <button
                            className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none"
                            {...dragHandleListeners}
                          >
                            <GripVertical className="w-4 h-4" />
                          </button>
                        )}
                        <SectionTitleRow
                          section={section}
                          isGhostSection={isGhostSection}
                          showGhostStyle={showGhostSectionStyle}
                          isReadOnly={isReadOnly}
                          editSectionId={editSectionId}
                          dispatch={dispatch}
                          submitEvent={submitEvent}
                          navigateTo={`/courses/${currentCourse.id}/sections/${section.id}`}
                        />
                        {showGhostSectionStyle && (
                          <Ghost className="w-3.5 h-3.5 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!isGhostSection && viewMode === "expanded" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {formatSecondsToTimeCode(sectionDuration)}
                          </Badge>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSection(section.id);
                          }}
                          className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
                        >
                          <ChevronRight
                            className={cn(
                              "w-4 h-4 transition-transform",
                              (!collapsedSections.has(section.id) ||
                                searchQuery) &&
                                "rotate-90"
                            )}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  {viewMode === "expanded" && (
                    <SectionDescriptionEditor
                      sectionId={section.id}
                      description={section.description ?? ""}
                      isReadOnly={isReadOnly}
                      submitEvent={submitEvent}
                    />
                  )}
                </div>
                {(!collapsedSections.has(section.id) || searchQuery) && (
                  <CompactLessonList
                    pairs={spinePairs}
                    revalidateKey={revalidateKey}
                    className={viewMode === "compact" ? "px-2 py-1" : "p-2"}
                  >
                    <SortableContext
                      items={lessons.map((l) => l.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {hasActiveFilters && filteredLessons.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-3">
                          No matching lessons
                        </p>
                      )}
                      {/* Contiguous Dependency Group runs: spacing
                      separates blocks, the measured overlay
                      draws the icon-to-icon dashed lines. */}
                      {runs.map((run) => (
                        <div
                          key={run.lessons[0]!.id}
                          className={runSpacingClass(run.lessons.length > 1)}
                        >
                          {run.lessons.map((lesson, idx) => (
                            <Fragment key={lesson.id}>
                              {dropIndicator?.targetSectionId === section.id &&
                                dropIndicator.beforeLessonId === lesson.id && (
                                  <DropLine />
                                )}
                              <SortableLessonItem
                                lesson={lesson}
                                lessonIndex={run.startIndex + idx}
                                section={section}
                                data={data}
                                navigate={navigate}
                                allFlatLessons={allFlatLessons}
                                addVideoToLessonId={addVideoToLessonId}
                                convertToGhostLessonId={convertToGhostLessonId}
                                deleteLessonId={deleteLessonId}
                                createOnDiskLessonId={createOnDiskLessonId}
                                editDescriptionLessonId={
                                  editDescriptionLessonId
                                }
                                dispatch={dispatch}
                                submitEvent={submitEvent}
                                startExportUpload={startExportUpload}
                                revealVideoFetcher={revealVideoFetcher}
                                deleteVideoFileFetcher={deleteVideoFileFetcher}
                                submitDeleteVideo={submitDeleteVideo}
                                allSections={currentCourse.sections}
                                dependencyMap={dependencyMap}
                                isGhostCourse={isGhostCourse}
                                compact={viewMode === "compact"}
                                isSelected={
                                  lessonSelection?.sectionId === section.id &&
                                  lessonSelection.lessonIds.has(lesson.id)
                                }
                                isBulkDragPeer={
                                  bulkDragIds != null &&
                                  bulkDragIds.has(lesson.id) &&
                                  lesson.id !== activeLesson?.id
                                }
                              />
                            </Fragment>
                          ))}
                        </div>
                      ))}
                      {/* Anchor at the end of the list (append, or
                      dropping into an empty section). */}
                      {dropIndicator?.targetSectionId === section.id &&
                        dropIndicator.beforeLessonId === null && <DropLine />}
                    </SortableContext>
                  </CompactLessonList>
                )}
              </div>
            </ContextMenuTrigger>
            <SectionContextMenuItems
              section={section}
              lessons={lessons}
              allSectionIds={allSectionIds}
              isReadOnly={isReadOnly}
              isGhostSection={isGhostSection}
              dispatch={dispatch}
              submitEvent={submitEvent}
            />
          </ContextMenu>
          <SectionModals
            sectionId={section.id}
            sectionPath={section.path}
            lessonCount={lessons.length}
            addGhostLessonSectionId={addGhostLessonSectionId}
            insertAdjacentLessonId={insertAdjacentLessonId}
            insertPosition={insertPosition}
            archiveSectionId={archiveSectionId}
            courseFilePath={currentCourse.filePath}
            dispatch={dispatch}
            submitEvent={submitEvent}
          />
        </>
      )}
    </SortableSectionItem>
  );
}
