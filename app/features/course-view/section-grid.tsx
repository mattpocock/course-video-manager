import { AddGhostLessonModal } from "@/components/add-ghost-lesson-modal";
import { ArchiveSectionModal } from "@/components/archive-section-modal";
import { type DependencyLessonItem } from "@/components/dependency-selector";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { SortableLessonItem } from "./sortable-lesson-item";
import { SortableSectionItem } from "./sortable-section-item";
import { SectionDescriptionEditor } from "./section-description-editor";
import {
  useSectionTitleEditor,
  SectionTitleEditor,
} from "./section-title-editor";
import { filterLessons, calcSectionDuration } from "./section-grid-utils";
import { DependencyDragProvider } from "./dependency-drag-context";
import { type LoaderData } from "./course-view-types";

import { formatSecondsToTimeCode } from "@/services/utils";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Archive,
  ChevronRight,
  ClipboardCopy,
  Ghost,
  GripVertical,
  PencilIcon,
  Plus,
} from "lucide-react";
import { useState, useCallback } from "react";
import { useNavigate, useFetcher } from "react-router";

function SectionTitleRow({
  section,
  isGhostSection,
  showGhostStyle,
  isReadOnly,
  editSectionId,
  dispatch,
  submitEvent,
}: {
  section: { id: string; path: string };
  isGhostSection: boolean;
  showGhostStyle: boolean;
  isReadOnly: boolean;
  editSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
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
    />
  );
}

export function SectionGrid({
  currentCourse,
  data,
  sensors,
  handleSectionDragEnd,
  handleLessonDragEnd,
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
  archiveSectionId,
  dispatch,
  submitEvent,
  navigate,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
  isGhostCourse,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
  data: LoaderData;
  isGhostCourse: boolean;
  viewMode: "expanded" | "compact";
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
  handleLessonDragEnd: (
    sectionId: string,
    lessons: {
      id: string;
      title?: string | null;
      path: string;
      dependencies?: string[] | null;
    }[]
  ) => (event: DragEndEvent) => void;
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
  archiveSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  navigate: ReturnType<typeof useNavigate>;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
}) {
  const COLLAPSED_SECTIONS_KEY = "collapsed-sections";

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => {
      if (typeof localStorage === "undefined") return new Set();
      try {
        const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
        if (stored) return new Set(JSON.parse(stored) as string[]);
      } catch {}
      return new Set();
    }
  );

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(
            COLLAPSED_SECTIONS_KEY,
            JSON.stringify([...next])
          );
        } catch {}
      }
      return next;
    });
  }, []);

  const displaySections = currentCourse.sections;

  // Build flat lessons list for dependency selector
  const allFlatLessons: DependencyLessonItem[] = displaySections.flatMap(
    (section, sectionIdx) =>
      section.lessons.map((lesson, lessonIdx) => ({
        id: lesson.id,
        number: `${sectionIdx + 1}.${lessonIdx + 1}`,
        title:
          lesson.fsStatus === "ghost"
            ? lesson.title || lesson.path
            : lesson.path,
        sectionId: section.id,
        sectionTitle: section.path,
        sectionNumber: sectionIdx + 1,
      }))
  );

  // Build dependency map for circular dependency detection
  const dependencyMap: Record<string, string[]> = {};
  for (const section of displaySections) {
    for (const lesson of section.lessons) {
      if (lesson.dependencies && lesson.dependencies.length > 0) {
        dependencyMap[lesson.id] = lesson.dependencies;
      }
    }
  }

  const isReadOnly = !data.isLatestVersion;

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

  return (
    <DependencyDragProvider
      dependencyMap={dependencyMap}
      onDrop={handleDependencyDrop}
      isReadOnly={isReadOnly}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd(
          displaySections,
          data.selectedVersion!.id
        )}
      >
        <SortableContext
          items={displaySections.map((s) => s.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {displaySections.map((section) => {
              const lessons = section.lessons;

              const { filteredLessons, hasActiveFilters } = filterLessons(
                lessons,
                { priorityFilter, iconFilter, fsStatusFilter, searchQuery }
              );

              const sectionDuration = calcSectionDuration(lessons);

              const isGhostSection =
                lessons.length === 0 ||
                lessons.every((l) => l.fsStatus === "ghost");
              const showGhostSectionStyle = isGhostSection && !isGhostCourse;

              return (
                <SortableSectionItem key={section.id} id={section.id}>
                  {(dragHandleListeners) => (
                    <>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div className="cursor-context-menu">
                            <div className="border-b bg-muted/30">
                              <div className="px-4 py-3">
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
                                    />
                                    {showGhostSectionStyle && (
                                      <Ghost className="w-3.5 h-3.5 text-muted-foreground/40" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {!isGhostSection &&
                                      viewMode === "expanded" && (
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px]"
                                        >
                                          {formatSecondsToTimeCode(
                                            sectionDuration
                                          )}
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
                            {(!collapsedSections.has(section.id) ||
                              searchQuery) && (
                              <div className="p-2">
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={handleLessonDragEnd(
                                    section.id,
                                    lessons
                                  )}
                                >
                                  <SortableContext
                                    items={lessons.map((l) => l.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    {hasActiveFilters &&
                                      filteredLessons.length === 0 && (
                                        <p className="text-xs text-muted-foreground text-center py-3">
                                          No matching lessons
                                        </p>
                                      )}
                                    {filteredLessons.map((lesson, li) => (
                                      <SortableLessonItem
                                        key={lesson.id}
                                        lesson={lesson}
                                        lessonIndex={li}
                                        section={section}
                                        data={data}
                                        navigate={navigate}
                                        allFlatLessons={allFlatLessons}
                                        addVideoToLessonId={addVideoToLessonId}
                                        convertToGhostLessonId={
                                          convertToGhostLessonId
                                        }
                                        deleteLessonId={deleteLessonId}
                                        createOnDiskLessonId={
                                          createOnDiskLessonId
                                        }
                                        dispatch={dispatch}
                                        submitEvent={submitEvent}
                                        startExportUpload={startExportUpload}
                                        revealVideoFetcher={revealVideoFetcher}
                                        deleteVideoFileFetcher={
                                          deleteVideoFileFetcher
                                        }
                                        submitDeleteVideo={submitDeleteVideo}
                                        allSections={currentCourse.sections}
                                        dependencyMap={dependencyMap}
                                        isGhostCourse={isGhostCourse}
                                        compact={viewMode === "compact"}
                                      />
                                    ))}
                                  </SortableContext>
                                </DndContext>
                              </div>
                            )}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          {!isReadOnly && (
                            <>
                              <ContextMenuItem
                                onSelect={() =>
                                  dispatch({
                                    type: "set-add-lesson-section-id",
                                    sectionId: section.id,
                                  })
                                }
                              >
                                <Plus className="w-4 h-4" />
                                Add Lesson
                              </ContextMenuItem>
                              <ContextMenuItem
                                onSelect={() =>
                                  dispatch({
                                    type: "set-edit-section-id",
                                    sectionId: section.id,
                                  })
                                }
                              >
                                <PencilIcon className="w-4 h-4" />
                                Rename
                              </ContextMenuItem>
                            </>
                          )}
                          {lessons.length > 0 && (
                            <ContextMenuItem
                              onSelect={() =>
                                dispatch({
                                  type: "open-copy-section-transcript",
                                  sectionPath: section.path,
                                  sectionDescription:
                                    section.description ?? undefined,
                                  lessons,
                                })
                              }
                            >
                              <ClipboardCopy className="w-4 h-4" />
                              Copy Section Transcript
                            </ContextMenuItem>
                          )}
                          {!isReadOnly && isGhostSection && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  if (lessons.length === 0) {
                                    submitEvent({
                                      type: "archive-section",
                                      sectionId: section.id,
                                    });
                                  } else {
                                    dispatch({
                                      type: "set-archive-section-id",
                                      sectionId: section.id,
                                    });
                                  }
                                }}
                              >
                                <Archive className="w-4 h-4" />
                                Archive Section
                              </ContextMenuItem>
                            </>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                      <AddGhostLessonModal
                        sectionId={section.id}
                        open={addGhostLessonSectionId === section.id}
                        onOpenChange={(open) => {
                          dispatch({
                            type: "set-add-lesson-section-id",
                            sectionId: open ? section.id : null,
                          });
                        }}
                        onAddLesson={({ title, isReal }) => {
                          submitEvent({
                            type: isReal
                              ? "create-real-lesson"
                              : "add-ghost-lesson",
                            sectionId: section.id,
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
                        courseFilePath={currentCourse.filePath}
                      />
                      <ArchiveSectionModal
                        sectionId={section.id}
                        sectionTitle={section.path}
                        lessonCount={lessons.length}
                        open={archiveSectionId === section.id}
                        onOpenChange={(open) => {
                          dispatch({
                            type: "set-archive-section-id",
                            sectionId: open ? section.id : null,
                          });
                        }}
                        onArchive={() => {
                          submitEvent({
                            type: "archive-section",
                            sectionId: section.id,
                          });
                        }}
                      />
                    </>
                  )}
                </SortableSectionItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </DependencyDragProvider>
  );
}
