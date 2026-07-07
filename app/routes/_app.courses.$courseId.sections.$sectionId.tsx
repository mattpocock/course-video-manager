"use client";

import { VideoModal } from "@/components/video-player";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { makeLoader } from "@/services/route-action.server";
import { courseViewEffect } from "@/features/course-view/course-view-loader.server";
import { NotFoundError } from "@/services/db-service-errors";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Effect } from "effect";
import { ChevronLeft } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import {
  Link,
  useFetcher,
  useLocation,
  useNavigate,
  useSubmit,
} from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import type { Route } from "./+types/_app.courses.$courseId.sections.$sectionId";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { GenerateChaptersProvider } from "@/features/course-view/generate-chapters-context";
import { SectionGrid } from "@/features/course-view/section-grid";
import { ReadOnlyBanner } from "@/features/course-view/course-view-components";
import { createSectionDragHandler } from "@/features/course-view/course-editor-helpers";
import {
  courseEditorFetcherKeyForEvent,
  deleteVideoFetcherKey,
} from "@/features/course-view/optimistic-applier";
import {
  useOptimisticCourse,
  useCourseEditorFailureToast,
} from "@/features/course-view/use-optimistic-course";
import { DivergenceReportModal } from "@/features/course-view/divergence-report-modal";
import { SegmentDescriptionsProvider } from "@/features/segments/segment-descriptions-context";

export const meta: Route.MetaFunction = ({ data }) => {
  const section = data?.selectedCourse?.sections[0];
  const courseName = data?.selectedCourse?.name;
  if (section && courseName) {
    return [{ title: `CVM - ${courseName} - ${section.path}` }];
  }
  return [{ title: "CVM" }];
};

/**
 * Section Workbench — a focused, single-Section reskin of the compact course
 * view. Reuses the very same {@link SectionGrid} (and the Section/Lesson/Segment
 * components beneath it) scoped to one Section, always in compact mode so the
 * Segment plan shows, with Segment Descriptions turned on for the whole subtree.
 * See docs/adr (Section Workbench) and the course view it links back to.
 */
export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const selectedVersionId = url.searchParams.get("versionId");

  return makeLoader({
    effect: ({ params }) =>
      courseViewEffect({
        courseId: params.courseId!,
        selectedVersionId,
        // The Segment plan only renders in compact mode; the Workbench always
        // shows it, so the cookie's view mode is irrelevant here.
        viewMode: "compact",
      }).pipe(
        Effect.flatMap((result) => {
          const sectionId = params.sectionId!;
          const section = result.selectedCourse?.sections.find(
            (s) => s.id === sectionId
          );
          if (!result.selectedCourse || !section) {
            return Effect.fail(
              new NotFoundError({ type: "section", params: { sectionId } })
            );
          }
          return Effect.succeed({
            ...result,
            selectedCourse: { ...result.selectedCourse, sections: [section] },
          });
        })
      ),
  })(args);
};

// The Workbench shows its single Section expanded — never collapsed.
const NO_COLLAPSED_SECTIONS = new Set<string>();
const noopToggleSection = () => {};

export default function Component(props: Route.ComponentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const courseId = props.params.courseId;
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
  const section = currentCourse?.sections[0];

  const {
    addGhostLessonSectionId,
    insertAdjacentLessonId,
    insertPosition,
    addVideoToLessonId,
    editSectionId,
    convertToGhostLessonId,
    deleteLessonId,
    createOnDiskLessonId,
    editDescriptionLessonId,
    archiveSectionId,
    lessonSelection,
    videoPlayerState,
    priorityFilter,
    iconFilter,
    fsStatusFilter,
    searchQuery,
  } = viewState;

  const { startExportUpload } = useContext(UploadContext);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSectionDragEnd = useMemo(
    () => createSectionDragHandler(submitEvent),
    [submitEvent]
  );

  // Deep link: scroll the linked lesson (anchor id = lesson id) into view once
  // the Workbench has rendered. Browsers don't reliably honor the hash after a
  // client-side navigation, so do it explicitly.
  const displaySections = currentCourse?.sections ?? [];
  const hash = location.hash;
  const scrolledHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hash || displaySections.length === 0) return;
    if (scrolledHashRef.current === hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolledHashRef.current = hash;
    }
  }, [hash, displaySections.length]);

  // Prune any lesson selection that no longer exists in this section.
  const lessonSelectionRef = useRef(lessonSelection);
  lessonSelectionRef.current = lessonSelection;
  useEffect(() => {
    const sel = lessonSelectionRef.current;
    if (!sel) return;
    const sec = displaySections.find((s) => s.id === sel.sectionId);
    const currentLessonIds = sec?.lessons.map((l) => l.id) ?? [];
    dispatch({ type: "prune-lesson-selection", currentLessonIds });
  }, [displaySections, dispatch]);

  return (
    <GenerateChaptersProvider>
      <div className="flex-1 flex flex-col bg-background text-foreground">
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {currentCourse && section ? (
              <>
                <Link
                  to={`/courses/${currentCourse.id}`}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {currentCourse.name}
                </Link>

                <h1 className="text-2xl font-bold mb-4">{section.path}</h1>

                {loaderData.selectedVersion && !loaderData.isLatestVersion && (
                  <div className="mb-4">
                    <ReadOnlyBanner />
                  </div>
                )}

                <SegmentDescriptionsProvider show>
                  <SectionGrid
                    currentCourse={currentCourse}
                    data={loaderData}
                    isGhostCourse={!currentCourse.filePath}
                    viewMode="compact"
                    singleColumn
                    sensors={sensors}
                    handleSectionDragEnd={handleSectionDragEnd}
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
                    editDescriptionLessonId={editDescriptionLessonId}
                    archiveSectionId={archiveSectionId}
                    collapsedSections={NO_COLLAPSED_SECTIONS}
                    toggleSection={noopToggleSection}
                    lessonSelection={lessonSelection}
                    dispatch={dispatch}
                    submitEvent={submitEvent}
                    navigate={navigate}
                    startExportUpload={startExportUpload}
                    revealVideoFetcher={revealVideoFetcher}
                    deleteVideoFileFetcher={deleteVideoFileFetcher}
                    submitDeleteVideo={submitDeleteVideo}
                  />
                </SegmentDescriptionsProvider>
              </>
            ) : (
              <div className="text-center py-12">
                <h1 className="text-xl font-semibold mb-2">
                  Section not found
                </h1>
                <p className="text-muted-foreground">
                  This section may have been archived or deleted.
                </p>
                {courseId && (
                  <Link
                    to={`/courses/${courseId}`}
                    className="text-primary hover:underline mt-2 inline-block"
                  >
                    Back to course
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <VideoModal
          videoId={videoPlayerState.videoId}
          videoPath={videoPlayerState.videoPath}
          isOpen={videoPlayerState.isOpen}
          onClose={() => dispatch({ type: "close-video-player" })}
        />

        <DivergenceReportModal
          report={divergenceReport}
          onClose={clearDivergenceReport}
        />
      </div>
    </GenerateChaptersProvider>
  );
}
