import { DuplicateCourseModal } from "@/components/duplicate-course-modal";
import { PurgeExportsModal } from "@/components/purge-exports-modal";
import { CopyTranscriptModal } from "@/components/copy-transcript-modal";
import { CopyVideoModal } from "@/components/copy-video-modal";
import { MoveVideoModal } from "@/components/move-video-modal";
import { RenameCourseModal } from "@/components/rename-course-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { VersionSelectorModal } from "@/components/version-selector-modal";
import { LessonBodyWriterModal } from "@/features/lesson-writer/lesson-body-writer-modal";
import { GenerateSeoDescriptionModal } from "@/features/lesson-writer/generate-seo-description-modal";
import { computeCourseStats } from "@/features/course-view/course-editor-helpers";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";

import {
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  List,
  ListChecks,
  MessageCircle,
  Play,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { Suspense } from "react";
import { useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import type { LoaderData } from "./course-view-types";

export function StatsBar({
  selectedCourse,
}: {
  selectedCourse: LoaderData["selectedCourse"];
}) {
  const {
    todoCount,
    totalLessons,
    totalVideos,
    totalDurationSeconds,
    percentageComplete,
  } = computeCourseStats(selectedCourse?.sections ?? []);

  const totalDurationFormatted = (() => {
    const hours = Math.floor(totalDurationSeconds / 3600);
    const minutes = Math.floor((totalDurationSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  })();

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
        {todoCount} / {totalLessons} to-dos ({percentageComplete}%)
      </span>
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
        {totalVideos} videos
      </span>
      {totalDurationSeconds > 0 && (
        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          {totalDurationFormatted}
        </span>
      )}
    </div>
  );
}

export function FilterBar({
  priorityFilter,
  iconFilter,
  todoFilter,
  todoCount,
  searchQuery,
  viewMode,
  onToggleViewMode,
  allSectionsCollapsed,
  onToggleAllSections,
  sectionCount,
  dispatch,
}: {
  priorityFilter: number[];
  iconFilter: string[];
  todoFilter: boolean;
  todoCount: number;
  searchQuery: string;
  viewMode: "expanded" | "compact";
  onToggleViewMode: () => void;
  allSectionsCollapsed: boolean;
  onToggleAllSections: () => void;
  sectionCount: number;
  dispatch: (action: courseViewReducer.Action) => void;
}) {
  const hasActiveFilters =
    priorityFilter.length > 0 ||
    iconFilter.length > 0 ||
    todoFilter ||
    searchQuery.length > 0;

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search"
          value={searchQuery}
          onChange={(e) =>
            dispatch({ type: "set-search-query", query: e.target.value })
          }
          className="pl-8 h-8 text-sm max-w-sm"
        />
        {searchQuery && (
          <button
            onClick={() => dispatch({ type: "set-search-query", query: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filters:</span>
        {([1, 2, 3] as const).map((priority) => {
          const isSelected = priorityFilter.includes(priority);
          const showAsActive = priorityFilter.length === 0 || isSelected;
          return (
            <button
              key={priority}
              className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors ${
                showAsActive
                  ? priority === 1
                    ? "bg-red-500/20 text-red-600"
                    : priority === 2
                      ? "bg-yellow-500/20 text-yellow-600"
                      : "bg-sky-500/20 text-sky-500"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() =>
                dispatch({ type: "toggle-priority-filter", priority })
              }
            >
              P{priority}
            </button>
          );
        })}

        <span className="text-muted-foreground mx-0.5">|</span>
        {(["code", "discussion", "watch"] as const).map((icon) => {
          const isSelected = iconFilter.includes(icon);
          const showAsActive = iconFilter.length === 0 || isSelected;
          return (
            <button
              key={icon}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
                icon === "code"
                  ? showAsActive
                    ? "bg-yellow-500/20 text-yellow-600"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                  : icon === "discussion"
                    ? showAsActive
                      ? "bg-green-500/20 text-green-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                    : showAsActive
                      ? "bg-purple-500/20 text-purple-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() => dispatch({ type: "toggle-icon-filter", icon })}
              title={
                icon === "code"
                  ? "Interactive"
                  : icon === "discussion"
                    ? "Discussion"
                    : "Watch"
              }
            >
              {icon === "code" ? (
                <Code className="w-3 h-3" />
              ) : icon === "discussion" ? (
                <MessageCircle className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
            </button>
          );
        })}

        <span className="text-muted-foreground mx-0.5">|</span>
        <button
          className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors flex items-center gap-1 ${
            todoFilter
              ? "bg-muted text-muted-foreground ring-1 ring-current"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => dispatch({ type: "toggle-todo-filter" })}
          title="Todo"
        >
          <ListChecks className="w-3 h-3" />
          Todo
          <span className="opacity-60">{todoCount}</span>
        </button>

        {hasActiveFilters && (
          <>
            <span className="text-muted-foreground mx-0.5">|</span>
            <button
              className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                if (priorityFilter.length > 0) {
                  for (const p of priorityFilter) {
                    dispatch({ type: "toggle-priority-filter", priority: p });
                  }
                }
                if (iconFilter.length > 0) {
                  for (const i of iconFilter) {
                    dispatch({ type: "toggle-icon-filter", icon: i });
                  }
                }
                if (todoFilter) {
                  dispatch({ type: "toggle-todo-filter" });
                }
                if (searchQuery) {
                  dispatch({ type: "set-search-query", query: "" });
                }
              }}
            >
              Clear all
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            className="flex items-center justify-center w-7 h-7 rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            onClick={onToggleAllSections}
            disabled={sectionCount === 0}
            title={
              allSectionsCollapsed
                ? "Expand all sections"
                : "Collapse all sections"
            }
            aria-label={
              allSectionsCollapsed
                ? "Expand all sections"
                : "Collapse all sections"
            }
          >
            {allSectionsCollapsed ? (
              <ChevronsUpDown className="w-4 h-4" />
            ) : (
              <ChevronsDownUp className="w-4 h-4" />
            )}
          </button>
          <button
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
              viewMode === "compact"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={onToggleViewMode}
            title={
              viewMode === "compact"
                ? "Switch to expanded view"
                : "Switch to compact view"
            }
          >
            {viewMode === "compact" ? (
              <List className="w-4 h-4" />
            ) : (
              <Rows3 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReadOnlyBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
      Viewing published version — read-only
    </div>
  );
}

export function RouteModals({
  currentCourse,
  data,
  selectedCourseId,
  viewState,
  dispatch,
  navigate,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]> | undefined;
  data: LoaderData;
  selectedCourseId: string | null;
  viewState: {
    isRenameCourseModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isPurgeExportsModalOpen: boolean;
    isCopyTranscriptModalOpen: boolean;
    isDuplicateCourseModalOpen: boolean;
    copySectionTranscriptState: {
      sectionTitle: string;
      sectionDescription: string | undefined;
      lessons: import("./course-view-types").Lesson[];
    } | null;
    moveVideoState: {
      videoId: string;
      videoTitle: string;
      currentLessonId: string;
    } | null;
    renameVideoState: {
      videoId: string;
      videoTitle: string;
    } | null;
    copyVideoState: {
      videoId: string;
      videoTitle: string;
      clipCount: number;
      beatCount: number;
    } | null;
    lessonBodyWriterVideoId: string | null;
    seoDescriptionVideoId: string | null;
    priorityFilter: number[];
    iconFilter: string[];
    todoFilter: boolean;
  };
  dispatch: (action: courseViewReducer.Action) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <>
      {currentCourse && (
        <RenameCourseModal
          courseId={currentCourse.id}
          currentName={currentCourse.name}
          open={viewState.isRenameCourseModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-rename-course-modal-open", open })
          }
        />
      )}

      {currentCourse && (
        <DuplicateCourseModal
          courseId={currentCourse.id}
          currentName={currentCourse.name}
          open={viewState.isDuplicateCourseModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-duplicate-course-modal-open", open })
          }
        />
      )}

      {selectedCourseId && data.versions.length > 0 && (
        <VersionSelectorModal
          versions={data.versions}
          selectedVersionId={data.selectedVersion?.id}
          isOpen={viewState.isVersionSelectorModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-version-selector-modal-open", open })
          }
          onSelectVersion={(versionId) => {
            navigate(`/courses/${selectedCourseId}?versionId=${versionId}`, {
              preventScrollReset: true,
            });
          }}
        />
      )}

      {currentCourse && data.selectedVersion && (
        <PurgeExportsModal
          repoId={currentCourse.id}
          versionId={data.selectedVersion.id}
          versionName={data.selectedVersion.name}
          open={viewState.isPurgeExportsModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-purge-exports-modal-open", open })
          }
        />
      )}

      <Suspense>
        {currentCourse && (
          <CopyTranscriptModal
            mode="course"
            courseName={currentCourse.name}
            sections={currentCourse.sections}
            videoTranscripts={data.videoTranscripts}
            open={viewState.isCopyTranscriptModalOpen}
            onOpenChange={(open) =>
              dispatch({ type: "set-copy-transcript-modal-open", open })
            }
            priorityFilter={viewState.priorityFilter}
            iconFilter={viewState.iconFilter}
            todoFilter={viewState.todoFilter}
            onTogglePriority={(priority) =>
              dispatch({ type: "toggle-priority-filter", priority })
            }
            onToggleIcon={(icon) =>
              dispatch({ type: "toggle-icon-filter", icon })
            }
            onToggleTodo={() => dispatch({ type: "toggle-todo-filter" })}
          />
        )}

        {viewState.copySectionTranscriptState && (
          <CopyTranscriptModal
            mode="section"
            sectionPath={viewState.copySectionTranscriptState.sectionTitle}
            sectionDescription={
              viewState.copySectionTranscriptState.sectionDescription
            }
            lessons={viewState.copySectionTranscriptState.lessons}
            videoTranscripts={data.videoTranscripts}
            open={true}
            onOpenChange={(open) => {
              if (!open) dispatch({ type: "close-copy-section-transcript" });
            }}
            priorityFilter={viewState.priorityFilter}
            iconFilter={viewState.iconFilter}
            todoFilter={viewState.todoFilter}
            onTogglePriority={(priority) =>
              dispatch({ type: "toggle-priority-filter", priority })
            }
            onToggleIcon={(icon) =>
              dispatch({ type: "toggle-icon-filter", icon })
            }
            onToggleTodo={() => dispatch({ type: "toggle-todo-filter" })}
          />
        )}
      </Suspense>

      {viewState.moveVideoState && currentCourse && (
        <MoveVideoModal
          videoId={viewState.moveVideoState.videoId}
          videoTitle={viewState.moveVideoState.videoTitle}
          currentLessonId={viewState.moveVideoState.currentLessonId}
          sections={currentCourse.sections}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-move-video" });
          }}
          onAfterMove={() => {
            dispatch({ type: "close-move-video" });
          }}
        />
      )}

      {viewState.renameVideoState && (
        <RenameVideoModal
          videoId={viewState.renameVideoState.videoId}
          currentName={viewState.renameVideoState.videoTitle}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-rename-video" });
          }}
          onRename={() => {
            dispatch({ type: "close-rename-video" });
          }}
        />
      )}

      {viewState.copyVideoState && (
        <CopyVideoModal
          videoId={viewState.copyVideoState.videoId}
          videoTitle={viewState.copyVideoState.videoTitle}
          clipCount={viewState.copyVideoState.clipCount}
          beatCount={viewState.copyVideoState.beatCount}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-copy-video" });
          }}
          onCopy={() => {
            dispatch({ type: "close-copy-video" });
          }}
        />
      )}

      {viewState.lessonBodyWriterVideoId && (
        <LessonBodyWriterModal
          videoId={viewState.lessonBodyWriterVideoId}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-lesson-body-writer" });
          }}
        />
      )}

      {viewState.seoDescriptionVideoId && (
        <GenerateSeoDescriptionModal
          videoId={viewState.seoDescriptionVideoId}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-seo-description" });
          }}
        />
      )}
    </>
  );
}
