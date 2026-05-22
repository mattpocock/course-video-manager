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
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  loadExportStatusMap,
  loadLessonFsMaps,
  toSlimVideo,
} from "@/services/course-loader-fs";
import type { ExportClip } from "@/services/export-hash";
import { FeatureFlagService } from "@/services/feature-flag-service";
import { runtimeLive } from "@/services/layer.server";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Console, Effect } from "effect";
import { getGitStatusAsync } from "@/services/git-status-service.server";
import { AlertTriangle, Plus } from "lucide-react";
import { Suspense, useCallback, useContext, useMemo, useState } from "react";
import { data, useFetcher, useNavigate, useSubmit } from "react-router";
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
  createLessonDragHandler,
  createSectionDragHandler,
  computeFsStatusCounts,
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
  const { courseId: selectedCourseId } = args.params;
  const url = new URL(args.request.url);
  const selectedVersionId = url.searchParams.get("versionId");

  return Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const featureFlags = yield* FeatureFlagService;

    const courses = yield* courseOps.getCourses();

    const versions = yield* versionOps.getCourseVersions(selectedCourseId);

    let selectedVersion: Awaited<
      ReturnType<typeof versionOps.getLatestCourseVersion>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = undefined;

    if (selectedVersionId) {
      selectedVersion = yield* versionOps
        .getCourseVersionById(selectedVersionId)
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
        );
    } else {
      selectedVersion =
        yield* versionOps.getLatestCourseVersion(selectedCourseId);
    }

    const selectedCourse = yield* courseOps
      .getCourseWithSlimClipsById(selectedCourseId, selectedVersion?.id)
      .pipe(
        Effect.andThen((course) => {
          if (!course) {
            return undefined;
          }

          const allSections = course.versions[0]?.sections ?? [];

          return {
            ...course,
            sections: allSections.filter((section) => {
              return !section.path.endsWith("ARCHIVE");
            }),
          };
        })
      );

    const allVideos = selectedCourse?.sections.flatMap((s) =>
      s.lessons.flatMap((l) => l.videos)
    );

    const slimCourse = selectedCourse
      ? (() => {
          const { versions, sections, ...courseRest } = selectedCourse;
          return {
            ...courseRest,
            sections: sections.map((section) => {
              const { lessons, ...sectionRest } = section;
              return {
                ...sectionRest,
                lessons: lessons.map((lesson) => {
                  const { videos, ...lessonRest } = lesson;
                  return {
                    ...lessonRest,
                    videos: videos.map(toSlimVideo),
                  };
                }),
              };
            }),
          };
        })()
      : undefined;

    const lessons = selectedCourse?.filePath
      ? selectedCourse.sections.flatMap((section) =>
          section.lessons
            .filter((lesson) => lesson.fsStatus !== "ghost")
            .map((lesson) => ({
              id: lesson.id,
              fullPath: `${selectedCourse.filePath}/${section.path}/${lesson.path}`,
            }))
        )
      : [];

    const hasExportedVideoMap = selectedCourse
      ? runtimeLive.runPromise(
          loadExportStatusMap({
            courseId: selectedCourse.id,
            videos: (allVideos ?? []).map((v) => ({
              id: v.id,
              clips: v.clips as ExportClip[],
            })),
          })
        )
      : Promise.resolve({} as Record<string, boolean>);

    const lessonFsMaps = runtimeLive.runPromise(loadLessonFsMaps({ lessons }));

    const videoTranscripts = runtimeLive.runPromise(
      courseOps.getVideoTranscripts(selectedCourseId)
    );

    const latestVersion = versions[0];
    const isLatestVersion = !!(
      selectedVersion &&
      latestVersion &&
      selectedVersion.id === latestVersion.id
    );

    const gitStatus = selectedCourse?.filePath
      ? getGitStatusAsync(selectedCourse.filePath)
      : Promise.resolve(null);

    return {
      courses,
      selectedCourse: slimCourse,
      versions,
      selectedVersion,
      isLatestVersion,
      hasExportedVideoMap,
      lessonFsMaps,
      videoTranscripts,
      gitStatus,
      showMediaFilesList: featureFlags.isEnabled("ENABLE_MEDIA_FILES_LIST"),
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Not Found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
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
  useCourseEditorFailureToast();

  const currentCourse = optimisticData.selectedCourse;
  const displaySections = currentCourse?.sections ?? [];

  const courseWarningCount = useMemo(() => {
    if (!loaderData.isLatestVersion) return 0;
    let count = 0;
    for (const section of displaySections) {
      for (const lesson of section.lessons) {
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
    addGhostLessonSectionId,
    insertAdjacentLessonId,
    insertPosition,
    addVideoToLessonId,
    editSectionId,
    convertToGhostLessonId,
    deleteLessonId,
    createOnDiskLessonId,
    archiveSectionId,
    videoPlayerState,
    priorityFilter,
    iconFilter,
    fsStatusFilter,
    searchQuery,
  } = viewState;

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
  const gitPushFetcher = useFetcher();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleLessonDragEnd = useMemo(
    () => createLessonDragHandler(submitEvent),
    [submitEvent]
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

  const fsStatusCounts = useMemo(
    () =>
      computeFsStatusCounts(displaySections, {
        priorityFilter,
        iconFilter,
        searchQuery,
      }),
    [displaySections, priorityFilter, iconFilter, searchQuery]
  );

  const handleBatchExport = () => {
    if (!loaderData.selectedVersion) return;
    startBatchExportUpload(loaderData.selectedVersion.id);
  };

  return (
    <GenerateChaptersProvider>
      <div className="flex-1 flex flex-col bg-background text-foreground">
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
                    gitPushFetcher={gitPushFetcher}
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

                {loaderData.selectedVersion && !loaderData.isLatestVersion && (
                  <ReadOnlyBanner />
                )}

                <div className="mb-10">
                  <StatsBar
                    selectedCourse={currentCourse}
                    gitStatus={loaderData.gitStatus}
                  />
                </div>

                <Suspense>
                  {loaderData.isLatestVersion && (
                    <div className="mb-14">
                      <NextTodoCard
                        sections={displaySections}
                        data={loaderData}
                        navigate={navigate}
                        addVideoToLessonId={addVideoToLessonId}
                        convertToGhostLessonId={convertToGhostLessonId}
                        deleteLessonId={deleteLessonId}
                        createOnDiskLessonId={createOnDiskLessonId}
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
                    <h2 className="text-lg font-semibold mb-3">All Lessons</h2>
                    <FilterBar
                      priorityFilter={priorityFilter}
                      iconFilter={iconFilter}
                      fsStatusFilter={fsStatusFilter}
                      fsStatusCounts={fsStatusCounts}
                      searchQuery={searchQuery}
                      dispatch={dispatch}
                      isRealCourse={currentCourse?.filePath != null}
                    />
                  </div>

                  <SectionGrid
                    currentCourse={currentCourse}
                    data={loaderData}
                    isGhostCourse={!currentCourse?.filePath}
                    sensors={sensors}
                    handleSectionDragEnd={handleSectionDragEnd}
                    handleLessonDragEnd={handleLessonDragEnd}
                    priorityFilter={priorityFilter}
                    iconFilter={iconFilter}
                    fsStatusFilter={fsStatusFilter}
                    searchQuery={searchQuery}
                    addGhostLessonSectionId={addGhostLessonSectionId}
                    insertAdjacentLessonId={insertAdjacentLessonId}
                    insertPosition={insertPosition}
                    editSectionId={editSectionId}
                    addVideoToLessonId={addVideoToLessonId}
                    convertToGhostLessonId={convertToGhostLessonId}
                    deleteLessonId={deleteLessonId}
                    createOnDiskLessonId={createOnDiskLessonId}
                    archiveSectionId={archiveSectionId}
                    dispatch={dispatch}
                    submitEvent={submitEvent}
                    navigate={navigate}
                    startExportUpload={startExportUpload}
                    revealVideoFetcher={revealVideoFetcher}
                    deleteVideoFileFetcher={deleteVideoFileFetcher}
                    submitDeleteVideo={submitDeleteVideo}
                  />

                  {loaderData.selectedVersion && loaderData.isLatestVersion && (
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
                </Suspense>

                {loaderData.selectedVersion && loaderData.isLatestVersion && (
                  <CreateSectionModal
                    repoVersionId={loaderData.selectedVersion.id}
                    maxOrder={displaySections.length}
                    open={isCreateSectionModalOpen}
                    onOpenChange={(open) =>
                      dispatch({ type: "set-create-section-modal-open", open })
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
                      });
                    }}
                  />
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <h1 className="text-xl font-semibold mb-2">Course not found</h1>
                <p className="text-muted-foreground">
                  This course may have been archived or deleted.
                </p>
              </div>
            )}
          </div>
        </div>

        <VideoModal
          videoId={videoPlayerState.videoId}
          videoPath={videoPlayerState.videoPath}
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
      </div>
    </GenerateChaptersProvider>
  );
}
