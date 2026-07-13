"use client";

import { CreateSectionModal } from "@/components/create-section-modal";
import { VideoModal } from "@/components/video-player";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { Button } from "@/components/ui/button";
import { makeLoader } from "@/services/route-action.server";
import { courseViewEffect } from "@/features/course-view/course-view-loader.server";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AlertTriangle, Plus } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCollapsedSections } from "@/features/course-view/use-collapsed-sections";
import { readCookie, useCookieState } from "@/hooks/use-cookie-state";
import { useFetcher, useNavigate, useSubmit } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import type { Route } from "./+types/_app.courses.$courseId._index";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { ActionsDropdown } from "@/features/course-view/actions-menu";
import { GenerateChaptersProvider } from "@/features/course-view/generate-chapters-context";
import { SectionGrid } from "@/features/course-view/section-grid";
import {
  FilterBar,
  StatsBar,
  ReadOnlyBanner,
  RouteModals,
} from "@/features/course-view/course-view-components";
import { NextTodoCard } from "@/features/course-view/next-todo-card";
import {
  createSectionDragHandler,
  computeTodoCount,
  computeFlatLessons,
  computeDependencyMap,
} from "@/features/course-view/course-editor-helpers";
import {
  courseEditorFetcherKeyForEvent,
  deleteVideoFetcherKey,
} from "@/features/course-view/optimistic-applier";
import {
  useOptimisticCourse,
  useCourseEditorFailureToast,
} from "@/features/course-view/use-optimistic-course";
import { DivergenceReportModal } from "@/features/course-view/divergence-report-modal";

export const meta: Route.MetaFunction = ({ data }) => {
  const selectedCourse = data?.selectedCourse;

  if (selectedCourse) {
    return [
      {
        title: `CVM - ${selectedCourse.name}`,
      },
    ];
  }

  return [
    {
      title: "CVM",
    },
  ];
};

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const selectedVersionId = url.searchParams.get("versionId");

  const viewMode =
    readCookie(args.request.headers.get("Cookie"), "view-mode") === "compact"
      ? "compact"
      : "expanded";

  return makeLoader({
    effect: ({ params }) =>
      courseViewEffect({
        courseId: params.courseId!,
        selectedVersionId,
        viewMode,
      }),
  })(args);
};

export default function Component(props: Route.ComponentProps) {
  const navigate = useNavigate();
  const selectedCourseId = props.params.courseId;
  const loaderData = props.loaderData;

  const [viewState, dispatch] = useEffectReducer(
    courseViewReducer,
    createInitialCourseViewState(),
    {}
  );

  const submit = useSubmit();

  const submitEvent = useCallback(
    (event: CourseEditorEvent) => {
      submit(event, {
        method: "post",
        encType: "application/json",
        action: "/api/course-editor",
        navigate: false,
        fetcherKey: courseEditorFetcherKeyForEvent(event),
      });
    },
    [submit]
  );

  const optimisticData = useOptimisticCourse(loaderData);
  const { divergenceReport, clearDivergenceReport } =
    useCourseEditorFailureToast();

  const currentCourse = optimisticData.selectedCourse;
  const displaySections = currentCourse?.sections ?? [];

  const courseWarningCount = useMemo(() => {
    if (!loaderData.isLatestVersion) return 0;
    let count = 0;
    for (const section of displaySections) {
      for (const lesson of section.lessons) {
        if (lesson.lessonWarnings && lesson.lessonWarnings.length > 0) {
          count++;
        }
        for (const video of lesson.videos) {
          if (video.warnings.some((w) => w.kind === "missingOpeningChapter")) {
            count++;
          }
        }
      }
    }
    return count;
  }, [displaySections, loaderData.isLatestVersion]);

  const {
    isCreateSectionModalOpen,
    insertAdjacentSectionId,
    insertSectionPosition,
    addLessonSectionId,
    insertAdjacentLessonId,
    insertPosition,
    addVideoToLessonId,
    editSectionId,
    deleteLessonId,
    editDescriptionLessonId,
    archiveSectionId,
    lessonSelection,
    videoPlayerState,
    priorityFilter,
    iconFilter,
    todoFilter,
    searchQuery,
  } = viewState;

  const [viewMode, setViewMode] = useCookieState(
    "view-mode",
    loaderData.viewMode
  ) as ["expanded" | "compact", (value: "expanded" | "compact") => void];

  const { collapsedSections, toggleSection, expandAll, collapseAll } =
    useCollapsedSections();

  const sectionIds = useMemo(
    () => displaySections.map((s) => s.id),
    [displaySections]
  );
  const allSectionsCollapsed =
    sectionIds.length > 0 &&
    sectionIds.every((id) => collapsedSections.has(id));
  const handleToggleAllSections = useCallback(() => {
    if (allSectionsCollapsed) {
      expandAll(sectionIds);
    } else {
      collapseAll(sectionIds);
    }
  }, [allSectionsCollapsed, expandAll, collapseAll, sectionIds]);

  const [nextUpDismissed, setNextUpDismissed] = useState(false);
  const { startExportUpload, startBatchExportUpload } =
    useContext(UploadContext);

  useFocusRevalidate({ enabled: true, intervalMs: 5000 });

  const submitDeleteVideo = useCallback(
    (videoId: string) => {
      submit(
        { videoId },
        {
          method: "post",
          action: "/api/videos/delete",
          navigate: false,
          fetcherKey: deleteVideoFetcherKey(videoId),
        }
      );
    },
    [submit]
  );

  const deleteVideoFileFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const archiveCourseFetcher = useFetcher();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSectionDragEnd = useMemo(
    () => createSectionDragHandler(submitEvent),
    [submitEvent]
  );

  const allFlatLessons = useMemo(
    () => computeFlatLessons(displaySections),
    [displaySections]
  );

  const dependencyMap = useMemo(
    () => computeDependencyMap(displaySections),
    [displaySections]
  );

  const todoCount = useMemo(
    () =>
      computeTodoCount(displaySections, {
        priorityFilter,
        iconFilter,
        searchQuery,
      }),
    [displaySections, priorityFilter, iconFilter, searchQuery]
  );

  const handleBatchExport = () => {
    if (!loaderData.selectedVersion) return;
    // Course-view Export All ships the whole version — include every lesson.
    startBatchExportUpload(loaderData.selectedVersion.id, true);
  };

  const lessonSelectionRef = useRef(lessonSelection);
  lessonSelectionRef.current = lessonSelection;
  useEffect(() => {
    const sel = lessonSelectionRef.current;
    if (!sel) return;
    const section = displaySections.find((s) => s.id === sel.sectionId);
    const currentLessonIds = section?.lessons.map((l) => l.id) ?? [];
    dispatch({ type: "prune-lesson-selection", currentLessonIds });
  }, [displaySections, dispatch]);

  return (
    <GenerateChaptersProvider>
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-w-0 flex-col bg-background text-foreground">
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              {currentCourse ? (
                <>
                  {/* Title + version + actions */}
                  <div className="flex items-center gap-2 mb-2">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                      {currentCourse.name}
                      {loaderData.selectedVersion &&
                        loaderData.versions.length > 1 && (
                          <button
                            onClick={() =>
                              dispatch({
                                type: "set-version-selector-modal-open",
                                open: true,
                              })
                            }
                            className="text-muted-foreground hover:text-foreground transition-colors text-lg font-normal"
                          >
                            [{loaderData.selectedVersion.name || "Draft"}]
                          </button>
                        )}
                    </h1>
                    <ActionsDropdown
                      currentCourse={currentCourse}
                      data={loaderData}
                      dispatch={dispatch}
                      archiveCourseFetcher={archiveCourseFetcher}
                      handleBatchExport={handleBatchExport}
                    />
                    {courseWarningCount > 0 && (
                      <span
                        title={`${courseWarningCount} video warning${courseWarningCount === 1 ? "" : "s"}`}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {courseWarningCount} warning
                        {courseWarningCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {loaderData.selectedVersion &&
                    !loaderData.isLatestVersion && <ReadOnlyBanner />}

                  <div className="mb-10">
                    <StatsBar selectedCourse={currentCourse} />
                  </div>

                  <>
                    {loaderData.isLatestVersion && (
                      <div className="mb-14">
                        <NextTodoCard
                          courseId={selectedCourseId}
                          sections={displaySections}
                          data={loaderData}
                          navigate={navigate}
                          addVideoToLessonId={addVideoToLessonId}
                          deleteLessonId={deleteLessonId}
                          editDescriptionLessonId={editDescriptionLessonId}
                          dispatch={dispatch}
                          submitEvent={submitEvent}
                          startExportUpload={startExportUpload}
                          revealVideoFetcher={revealVideoFetcher}
                          deleteVideoFileFetcher={deleteVideoFileFetcher}
                          submitDeleteVideo={submitDeleteVideo}
                          allFlatLessons={allFlatLessons}
                          dependencyMap={dependencyMap}
                          dismissed={nextUpDismissed}
                          onDismiss={() => setNextUpDismissed(true)}
                        />
                      </div>
                    )}

                    <div className="mb-4">
                      <h2 className="text-lg font-semibold mb-3">
                        All Lessons
                      </h2>
                      <FilterBar
                        priorityFilter={priorityFilter}
                        iconFilter={iconFilter}
                        todoFilter={todoFilter}
                        todoCount={todoCount}
                        searchQuery={searchQuery}
                        viewMode={viewMode}
                        onToggleViewMode={() =>
                          setViewMode(
                            viewMode === "expanded" ? "compact" : "expanded"
                          )
                        }
                        allSectionsCollapsed={allSectionsCollapsed}
                        onToggleAllSections={handleToggleAllSections}
                        sectionCount={sectionIds.length}
                        dispatch={dispatch}
                      />
                    </div>

                    <SectionGrid
                      currentCourse={currentCourse}
                      data={loaderData}
                      viewMode={viewMode}
                      sensors={sensors}
                      handleSectionDragEnd={handleSectionDragEnd}
                      priorityFilter={priorityFilter}
                      iconFilter={iconFilter}
                      todoFilter={todoFilter}
                      searchQuery={searchQuery}
                      addLessonSectionId={addLessonSectionId}
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
                    />

                    {loaderData.selectedVersion &&
                      loaderData.isLatestVersion && (
                        <div className="mt-8 flex justify-center">
                          <Button
                            variant="outline"
                            className="border-dashed"
                            onClick={() =>
                              dispatch({
                                type: "set-create-section-modal-open",
                                open: true,
                              })
                            }
                          >
                            <Plus className="w-4 h-4" />
                            Add Section
                          </Button>
                        </div>
                      )}
                  </>

                  {loaderData.selectedVersion && loaderData.isLatestVersion && (
                    <CreateSectionModal
                      repoVersionId={loaderData.selectedVersion.id}
                      maxOrder={displaySections.length}
                      open={isCreateSectionModalOpen}
                      onOpenChange={(open) =>
                        dispatch({
                          type: "set-create-section-modal-open",
                          open,
                        })
                      }
                      onCreateSection={(title) => {
                        const maxOrder = displaySections.reduce(
                          (max, s) => Math.max(max, s.order ?? 0),
                          0
                        );
                        submitEvent({
                          type: "create-section",
                          repoVersionId: loaderData.selectedVersion!.id,
                          title,
                          maxOrder,
                          ...(insertAdjacentSectionId
                            ? {
                                adjacentSectionId: insertAdjacentSectionId,
                                position: insertSectionPosition ?? undefined,
                              }
                            : {}),
                        });
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <h1 className="text-xl font-semibold mb-2">
                    Course not found
                  </h1>
                  <p className="text-muted-foreground">
                    This course may have been archived or deleted.
                  </p>
                </div>
              )}
            </div>
          </div>

          <VideoModal
            videoId={videoPlayerState.videoId}
            videoTitle={videoPlayerState.videoTitle}
            isOpen={videoPlayerState.isOpen}
            onClose={() => {
              dispatch({ type: "close-video-player" });
            }}
          />

          <RouteModals
            currentCourse={currentCourse}
            data={loaderData}
            selectedCourseId={selectedCourseId}
            viewState={viewState}
            dispatch={dispatch}
            navigate={navigate}
          />

          <DivergenceReportModal
            report={divergenceReport}
            onClose={clearDivergenceReport}
          />
        </div>
      </div>
    </GenerateChaptersProvider>
  );
}
