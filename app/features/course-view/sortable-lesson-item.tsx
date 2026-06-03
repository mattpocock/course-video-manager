import { AddVideoModal } from "@/components/add-video-modal";
import { ConvertToGhostModal } from "@/components/convert-to-ghost-modal";
import { CreateOnDiskModal } from "./create-on-disk-modal";
import { DeleteLessonModal } from "@/components/delete-lesson-modal";
import { EditLessonDescriptionModal } from "@/components/edit-lesson-description-modal";
import {
  DependencySelector,
  type DependencyLessonItem,
} from "@/components/dependency-selector";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { PrioritySelector } from "@/components/priority-selector";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LessonTitleEditor, useLessonTitleEditor } from "./lesson-title-editor";
import { LessonContextMenuContent } from "./lesson-context-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { VideoThumbnailGrid } from "./video-thumbnail-grid";
import {
  type LoaderData,
  type Section,
  type Lesson,
} from "./course-view-types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Code, Ghost, GripVertical, MessageCircle, Play } from "lucide-react";

import { useLessonDependencyDrag } from "./use-lesson-dependency-drag";
import { Suspense, use, useCallback, useRef, useState } from "react";
import { useNavigate, useFetcher } from "react-router";

/**
 * Lesson modals whose props depend on the deferred `lessonFsMaps`. Kept in a
 * dedicated leaf so the `use()` call — and the suspense boundary around it —
 * sits here rather than at the top of the lesson item. The lesson row renders
 * immediately from synchronous data; only these (normally closed) modals wait
 * on the filesystem maps, so the list never flickers while they stream in.
 */
function LessonFsModals({
  lesson,
  isGhost,
  lessonFsMaps,
  addVideoToLessonId,
  deleteLessonId,
  convertToGhostLessonId,
  dispatch,
  submitEvent,
}: {
  lesson: Lesson;
  isGhost: boolean;
  lessonFsMaps: LoaderData["lessonFsMaps"];
  addVideoToLessonId: string | null;
  deleteLessonId: string | null;
  convertToGhostLessonId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  const fsMaps = use(lessonFsMaps);
  return (
    <>
      <AddVideoModal
        lessonId={lesson.id}
        videoCount={lesson.videos.length}
        hasExplainerFolder={fsMaps.hasExplainerFolderMap[lesson.id] ?? false}
        open={addVideoToLessonId === lesson.id}
        onOpenChange={(open) => {
          dispatch({
            type: "set-add-video-to-lesson-id",
            lessonId: open ? lesson.id : null,
          });
        }}
      />
      {!isGhost && (
        <DeleteLessonModal
          lessonId={lesson.id}
          lessonTitle={lesson.path}
          filesOnDisk={fsMaps.lessonHasFilesMap[lesson.id] ?? []}
          open={deleteLessonId === lesson.id}
          onOpenChange={(open) => {
            dispatch({
              type: "set-delete-lesson-id",
              lessonId: open ? lesson.id : null,
            });
          }}
          onDelete={() => {
            submitEvent({
              type: "delete-lesson",
              lessonId: lesson.id,
            });
          }}
        />
      )}
      {!isGhost && (
        <ConvertToGhostModal
          lessonId={lesson.id}
          lessonTitle={lesson.path}
          filesOnDisk={fsMaps.lessonHasFilesMap[lesson.id] ?? []}
          hasVideos={lesson.videos.length > 0}
          open={convertToGhostLessonId === lesson.id}
          onOpenChange={(open) => {
            dispatch({
              type: "set-convert-to-ghost-lesson-id",
              lessonId: open ? lesson.id : null,
            });
          }}
          onConvert={() => {
            submitEvent({
              type: "convert-to-ghost",
              lessonId: lesson.id,
            });
          }}
        />
      )}
    </>
  );
}

export function SortableLessonItem({
  lesson,
  lessonIndex,
  section,
  data,
  navigate,
  addVideoToLessonId,
  convertToGhostLessonId,
  deleteLessonId,
  createOnDiskLessonId,
  editDescriptionLessonId,
  dispatch,
  submitEvent,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
  allFlatLessons,
  dependencyMap,
  allSections,
  hideAnchor,
  isGhostCourse,
  compact,
  isSelected,
  isBulkDragPeer,
}: {
  lesson: Lesson;
  lessonIndex: number;
  section: Section;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  addVideoToLessonId: string | null;
  convertToGhostLessonId: string | null;
  deleteLessonId: string | null;
  createOnDiskLessonId: string | null;
  editDescriptionLessonId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
  allFlatLessons: DependencyLessonItem[];
  dependencyMap: Record<string, string[]>;
  allSections: { id: string; path: string }[];
  hideAnchor?: boolean;
  isGhostCourse?: boolean;
  compact?: boolean;
  isSelected?: boolean;
  isBulkDragPeer?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: lesson.id,
    data: { type: "lesson", sectionId: section.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isBulkDragPeer ? 0.4 : undefined,
  };

  const isReadOnly = !data.isLatestVersion;
  const isGhost = lesson.fsStatus === "ghost";
  const showGhostStyle = isGhost && !isGhostCourse;

  const currentDescription = lesson.description ?? "";
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(lesson.description || "");
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    editingTitle,
    titleValue,
    setTitleValue,
    setEditingTitle,
    saveTitle,
    startEditingTitle,
    pathPrefix,
  } = useLessonTitleEditor({ lesson, isGhost, submitEvent });

  const currentIcon = (lesson.icon ?? "watch") as
    | "watch"
    | "code"
    | "discussion";
  const currentPriority = (lesson.priority ?? 2) as 1 | 2 | 3;

  const handleIconCycle = useCallback(() => {
    const nextIcon =
      currentIcon === "watch"
        ? "code"
        : currentIcon === "code"
          ? "discussion"
          : "watch";
    submitEvent({
      type: "update-lesson-icon",
      lessonId: lesson.id,
      icon: nextIcon,
    });
  }, [currentIcon, lesson.id, submitEvent]);

  const handlePrioritySelect = useCallback(
    (priority: 1 | 2 | 3) => {
      submitEvent({
        type: "update-lesson-priority",
        lessonId: lesson.id,
        priority,
      });
    },
    [lesson.id, submitEvent]
  );

  // Dependency violation checking
  const lessonDeps = lesson.dependencies ?? [];
  const flatLessonIdx = allFlatLessons.findIndex((l) => l.id === lesson.id);
  const orderViolations = lessonDeps
    .map((depId) => {
      const depIdx = allFlatLessons.findIndex((l) => l.id === depId);
      if (depIdx > flatLessonIdx) {
        const dep = allFlatLessons[depIdx];
        return dep ? { number: dep.number } : null;
      }
      return null;
    })
    .filter(Boolean) as { number: string }[];
  const lessonPriority = lesson.priority ?? 2;
  const priorityViolations = lessonDeps
    .map((depId) => {
      const dep = allFlatLessons.find((l) => l.id === depId);
      if (!dep) return null;
      const depLesson = data.selectedCourse?.sections
        .flatMap((s) => s.lessons)
        .find((l) => l.id === depId);
      const depPriority = depLesson?.priority ?? 2;
      if (depPriority > lessonPriority) {
        return { number: dep.number, priority: depPriority };
      }
      return null;
    })
    .filter(Boolean) as { number: string; priority: number }[];

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      if (isReadOnly) return;
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
        dispatch({
          type: "toggle-lesson-selection",
          lessonId: lesson.id,
          sectionId: section.id,
        });
      } else {
        dispatch({
          type: "select-lesson-only",
          lessonId: lesson.id,
          sectionId: section.id,
        });
      }
    },
    [isReadOnly, lesson.id, section.id, dispatch]
  );

  const { dragClassName, dragTargetHandlers } = useLessonDependencyDrag(
    lesson.id
  );

  const handleDependenciesChange = useCallback(
    (newDeps: string[]) => {
      submitEvent({
        type: "update-lesson-dependencies",
        lessonId: lesson.id,
        dependencies: newDeps,
      });
    },
    [lesson.id, submitEvent]
  );

  const saveDescription = useCallback(
    (value: string) => {
      setEditingDesc(false);
      if (value !== currentDescription) {
        submitEvent({
          type: "update-lesson-description",
          lessonId: lesson.id,
          description: value,
        });
      }
    },
    [currentDescription, lesson.id, submitEvent]
  );

  return (
    <div ref={setNodeRef} style={style} {...dragTargetHandlers}>
      {!hideAnchor && <a id={lesson.id} />}
      {lessonIndex > 0 && !compact && <Separator className="my-1" />}
      <div
        className={cn(
          "rounded-md px-2 group transition-shadow",
          compact ? "py-1" : "py-2",
          dragClassName,
          isSelected && "bg-primary/10 ring-1 ring-primary/20"
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div onClick={handleRowClick}>
              <div className="flex items-center gap-2 mb-1.5 cursor-context-menu hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                {!isReadOnly && (
                  <button
                    className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 touch-none flex items-center justify-center"
                    {...attributes}
                    {...listeners}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
                <button
                  data-dep-icon={lesson.id}
                  className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                    currentIcon === "code"
                      ? "bg-yellow-500/20 text-yellow-600"
                      : currentIcon === "discussion"
                        ? "bg-green-500/20 text-green-600"
                        : "bg-purple-500/20 text-purple-600"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isReadOnly) handleIconCycle();
                  }}
                  title={
                    currentIcon === "code"
                      ? isReadOnly
                        ? "Interactive"
                        : "Interactive (click to change)"
                      : currentIcon === "discussion"
                        ? isReadOnly
                          ? "Discussion"
                          : "Discussion (click to change)"
                        : isReadOnly
                          ? "Watch"
                          : "Watch (click to change)"
                  }
                >
                  {currentIcon === "code" ? (
                    <Code className="w-3 h-3" />
                  ) : currentIcon === "discussion" ? (
                    <MessageCircle className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </button>
                <LessonTitleEditor
                  lesson={lesson}
                  isGhost={isGhost}
                  isReadOnly={isReadOnly}
                  showGhostStyle={showGhostStyle}
                  editingTitle={editingTitle}
                  titleValue={titleValue}
                  pathPrefix={pathPrefix}
                  onTitleValueChange={setTitleValue}
                  onCancel={() => setEditingTitle(false)}
                  onSave={saveTitle}
                  onStartEditing={startEditingTitle}
                />
                {showGhostStyle && (
                  <span className="flex items-center text-muted-foreground/60 shrink-0">
                    <Ghost className="w-3 h-3" />
                  </span>
                )}
                <PrioritySelector
                  priority={currentPriority}
                  onSelect={handlePrioritySelect}
                  readOnly={isReadOnly}
                />
                <DependencySelector
                  lessonId={lesson.id}
                  dependencies={lessonDeps}
                  allLessons={allFlatLessons}
                  onDependenciesChange={handleDependenciesChange}
                  orderViolations={orderViolations}
                  priorityViolations={priorityViolations}
                  lessonPriority={lessonPriority}
                  dependencyMap={dependencyMap}
                />
                {!isGhost && lesson.authoringStatus === "todo" && (
                  <button
                    className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-foreground text-background hover:opacity-80 transition-opacity shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      submitEvent({
                        type: "set-lesson-authoring-status",
                        lessonId: lesson.id,
                        status: "done",
                      });
                    }}
                  >
                    todo
                  </button>
                )}
              </div>
              {!compact && (
                <div className="ml-5">
                  {!isReadOnly && editingDesc ? (
                    <div className="mt-1 max-w-[65ch]">
                      <Textarea
                        ref={descTextareaRef}
                        value={descValue}
                        onChange={(e) => setDescValue(e.target.value)}
                        placeholder="What should this lesson teach?"
                        className="text-sm min-h-[60px]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setDescValue(currentDescription);
                            setEditingDesc(false);
                          }
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            saveDescription(descValue);
                          }
                        }}
                        onBlur={() => saveDescription(descValue)}
                      />
                    </div>
                  ) : currentDescription ? (
                    <div
                      className={cn(
                        "text-xs text-muted-foreground mt-1 whitespace-pre-line max-w-[65ch]",
                        !isReadOnly && "cursor-pointer hover:text-foreground/70"
                      )}
                      onClick={() => {
                        if (isReadOnly) return;
                        setDescValue(currentDescription);
                        setEditingDesc(true);
                      }}
                    >
                      {currentDescription}
                    </div>
                  ) : !isReadOnly ? (
                    <button
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      onClick={() => {
                        setDescValue("");
                        setEditingDesc(true);
                      }}
                    >
                      + Add description
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <LessonContextMenuContent
            lesson={lesson}
            section={section}
            isGhost={isGhost}
            isReadOnly={isReadOnly}
            isGhostCourse={isGhostCourse}
            compact={compact}
            navigate={navigate}
            allSections={allSections}
            dispatch={dispatch}
            submitEvent={submitEvent}
            startEditingTitle={startEditingTitle}
            startEditingDescription={() =>
              dispatch({
                type: "set-edit-description-lesson-id",
                lessonId: lesson.id,
              })
            }
          />
        </ContextMenu>
        <Suspense>
          <LessonFsModals
            lesson={lesson}
            isGhost={isGhost}
            lessonFsMaps={data.lessonFsMaps}
            addVideoToLessonId={addVideoToLessonId}
            deleteLessonId={deleteLessonId}
            convertToGhostLessonId={convertToGhostLessonId}
            dispatch={dispatch}
            submitEvent={submitEvent}
          />
        </Suspense>
        {!compact && (
          <div className="ml-5 mt-3">
            <VideoThumbnailGrid
              videos={lesson.videos}
              section={section}
              lesson={lesson}
              data={data}
              navigate={navigate}
              dispatch={dispatch}
              startExportUpload={startExportUpload}
              revealVideoFetcher={revealVideoFetcher}
              deleteVideoFileFetcher={deleteVideoFileFetcher}
              submitDeleteVideo={submitDeleteVideo}
            />
          </div>
        )}
        <CreateOnDiskModal
          lessonId={lesson.id}
          open={createOnDiskLessonId === lesson.id}
          onOpenChange={(open) => {
            dispatch({
              type: "set-create-on-disk-lesson-id",
              lessonId: open ? lesson.id : null,
            });
          }}
          onCreateOnDisk={(repoPath) => {
            submitEvent({
              type: "create-on-disk",
              lessonId: lesson.id,
              repoPath,
            });
          }}
        />
        <EditLessonDescriptionModal
          lessonTitle={lesson.title || lesson.path}
          currentDescription={currentDescription}
          open={editDescriptionLessonId === lesson.id}
          onOpenChange={(open) => {
            dispatch({
              type: "set-edit-description-lesson-id",
              lessonId: open ? lesson.id : null,
            });
          }}
          onSave={(description) => {
            if (description !== currentDescription) {
              submitEvent({
                type: "update-lesson-description",
                lessonId: lesson.id,
                description,
              });
            }
          }}
        />
      </div>
    </div>
  );
}
