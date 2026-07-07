import { type DependencyLessonItem } from "@/components/dependency-selector";
import { cn } from "@/lib/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { SectionCard } from "./section-card";
import { DependencyDragProvider } from "./dependency-drag-context";
import { BeatDndProvider } from "@/features/beats/beat-dnd-context";
import { CreateBeatDialogProvider } from "@/features/beats/create-beat-dialog";
import { type LoaderData } from "./course-view-types";

import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useLessonDrag } from "./use-lesson-drag";
import { useCallback, useMemo, type ReactNode } from "react";
import { useNavigate, useFetcher } from "react-router";
import { useLessonSelectionClear } from "./use-lesson-selection-clear";

function MaybeBeatDnd({
  enabled,
  videos,
  submitEvent,
  children,
}: {
  enabled: boolean;
  videos: { id: string; beats: { id: string }[] }[];
  submitEvent: (event: CourseEditorEvent) => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <BeatDndProvider
      videos={videos}
      onMove={(drop) =>
        submitEvent({
          type: "move-beat",
          beatId: drop.beatId,
          targetVideoId: drop.targetVideoId,
          beforeBeatId: drop.beforeBeatId,
        })
      }
    >
      {children}
    </BeatDndProvider>
  );
}

export function SectionGrid({
  currentCourse,
  data,
  sensors,
  handleSectionDragEnd,
  priorityFilter,
  iconFilter,
  todoFilter,
  searchQuery,
  viewMode,
  addGhostLessonSectionId,
  insertAdjacentLessonId,
  insertPosition,
  editSectionId,
  addVideoToLessonId,
  deleteLessonId,
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
  singleColumn = false,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
  data: LoaderData;
  viewMode: "expanded" | "compact";
  singleColumn?: boolean;
  sensors: ReturnType<typeof useSensors>;
  handleSectionDragEnd: (
    sections: {
      id: string;
      lessons: {
        id: string;
        title?: string | null;
        path: string;
        dependencies?: string[] | null;
      }[];
    }[],
    repoVersionId: string
  ) => (event: DragEndEvent) => void;
  priorityFilter: number[];
  iconFilter: string[];
  todoFilter: boolean;
  searchQuery: string;
  addGhostLessonSectionId: string | null;
  insertAdjacentLessonId: string | null;
  insertPosition: "before" | "after" | null;
  editSectionId: string | null;
  addVideoToLessonId: string | null;
  deleteLessonId: string | null;
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
}) {
  const displaySections = currentCourse.sections;

  const allSectionIds = useMemo(
    () => displaySections.map((s) => s.id),
    [displaySections]
  );

  const allVideosForDnd = useMemo(
    () =>
      displaySections.flatMap((section) =>
        section.lessons.flatMap((lesson) =>
          lesson.videos.map((video) => ({
            id: video.id,
            beats: video.beats ?? [],
          }))
        )
      ),
    [displaySections]
  );

  const allFlatLessons: DependencyLessonItem[] = displaySections.flatMap(
    (section, sectionIdx) =>
      section.lessons.map((lesson, lessonIdx) => ({
        id: lesson.id,
        number: `${sectionIdx + 1}.${lessonIdx + 1}`,
        title: lesson.title || lesson.path,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionNumber: sectionIdx + 1,
      }))
  );

  const dependencyMap: Record<string, string[]> = {};
  for (const section of displaySections) {
    for (const lesson of section.lessons) {
      if (lesson.dependencies && lesson.dependencies.length > 0) {
        dependencyMap[lesson.id] = lesson.dependencies;
      }
    }
  }

  const isReadOnly = !data.isLatestVersion;

  const handleGridClick = useLessonSelectionClear(lessonSelection, dispatch);

  const handleDependencyDrop = useCallback(
    (sourceId: string, newDeps: string[]) => {
      submitEvent({
        type: "update-lesson-dependencies",
        lessonId: sourceId,
        dependencies: newDeps,
      });
    },
    [submitEvent]
  );

  const {
    dropIndicator,
    activeLesson,
    bulkDragIds,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  } = useLessonDrag({
    sections: displaySections,
    submitEvent,
    onSectionDragEnd: handleSectionDragEnd(
      displaySections,
      data.selectedVersion!.id
    ),
    lessonSelection,
    dispatch,
  });

  return (
    <DependencyDragProvider
      dependencyMap={dependencyMap}
      onDrop={handleDependencyDrop}
      isReadOnly={isReadOnly}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={allSectionIds} strategy={rectSortingStrategy}>
          <CreateBeatDialogProvider submitEvent={submitEvent}>
            <MaybeBeatDnd
              enabled={viewMode === "compact" && !isReadOnly}
              videos={allVideosForDnd}
              submitEvent={submitEvent}
            >
              <div
                className={cn(
                  "grid grid-cols-1 gap-8",
                  singleColumn
                    ? "lg:grid-cols-1"
                    : viewMode === "compact"
                      ? "lg:grid-cols-3"
                      : "lg:grid-cols-2"
                )}
                onClick={handleGridClick}
              >
                {displaySections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    currentCourse={currentCourse}
                    data={data}
                    priorityFilter={priorityFilter}
                    iconFilter={iconFilter}
                    todoFilter={todoFilter}
                    searchQuery={searchQuery}
                    viewMode={viewMode}
                    addGhostLessonSectionId={addGhostLessonSectionId}
                    insertAdjacentLessonId={insertAdjacentLessonId}
                    insertPosition={insertPosition}
                    editSectionId={editSectionId}
                    addVideoToLessonId={addVideoToLessonId}
                    deleteLessonId={deleteLessonId}
                    editDescriptionLessonId={editDescriptionLessonId}
                    archiveSectionId={archiveSectionId}
                    collapsedSections={collapsedSections}
                    toggleSection={toggleSection}
                    lessonSelection={lessonSelection}
                    dispatch={dispatch}
                    submitEvent={submitEvent}
                    navigate={navigate}
                    startExportUpload={startExportUpload}
                    revealVideoFetcher={revealVideoFetcher}
                    deleteVideoFileFetcher={deleteVideoFileFetcher}
                    submitDeleteVideo={submitDeleteVideo}
                    isReadOnly={isReadOnly}
                    allSectionIds={allSectionIds}
                    allFlatLessons={allFlatLessons}
                    dependencyMap={dependencyMap}
                    dropIndicator={dropIndicator}
                    activeLesson={activeLesson}
                    bulkDragIds={bulkDragIds}
                  />
                ))}
              </div>
            </MaybeBeatDnd>
          </CreateBeatDialogProvider>
        </SortableContext>
        <DragOverlay>
          {activeLesson ? (
            <div className="rounded-md border bg-card px-2 py-1 text-sm shadow-lg flex items-center gap-2">
              <span>{activeLesson.title || activeLesson.path}</span>
              {bulkDragIds && bulkDragIds.size > 1 && (
                <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium min-w-5 h-5 px-1.5">
                  {bulkDragIds.size}
                </span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DependencyDragProvider>
  );
}
