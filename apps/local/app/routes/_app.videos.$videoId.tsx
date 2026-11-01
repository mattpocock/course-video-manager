import { AddVideoModal } from "@/components/add-video-modal";
import { formatVideoBreadcrumb } from "@/lib/video-breadcrumb";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { LessonPlaceProvider } from "@/features/entity-links/lesson-place-context";
import type { FindLessonPlace } from "@/features/entity-links/entity-deep-link";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { useVideoDialogs } from "@/features/video-menu/video-dialogs";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { getBackButtonUrl } from "@/features/video-editor/video-editor-selectors";
import { cn } from "@/lib/utils";
import { postSubTabs } from "@/features/video-posting/post-sub-tabs";
import { type VideoFormat } from "@/features/videos/video-format";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  VideoIcon,
  SendIcon,
  PlayIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useMatches,
  useNavigate,
  useSubmit,
} from "react-router";
import type { Route } from "./+types/_app.videos.$videoId";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const clipMockupOps = yield* ClipMockupOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);

      // The editor's compact header offers the Animatic only when there is
      // something to watch, so the count comes down with every tab of the
      // Video. The rows themselves stay behind the Animatic route: sixty frame
      // paths are of no use to a header.
      const clipMockupCount = (yield* clipMockupOps.listClipMockupsByVideoId(
        videoId
      )).length;

      const [nextVideoId, previousVideoId] = yield* Effect.all([
        videoOps.getNextVideoId(video),
        videoOps.getPreviousVideoId(video),
      ]);

      const lesson = video.lesson;
      const videoFormat = video.format as VideoFormat;

      if (!lesson) {
        return {
          videoId,
          videoTitle: video.title,
          videoFormat,
          lessonPath: null,
          sectionPath: null,
          repoId: null,
          lessonId: null,
          sectionId: null,
          pitchId: video.pitchId,
          isStandalone: true,
          format: video.format,
          nextVideoId,
          previousVideoId,
          videoCount: 1,
          hasExplainerFolder: false,
          clipMockupCount,
        };
      }

      return {
        videoId,
        videoTitle: video.title,
        videoFormat,
        lessonPath: lesson.title,
        sectionPath: lesson.section.title,
        repoId: lesson.section.repoVersion.repoId,
        lessonId: lesson.id,
        sectionId: lesson.section.id,
        pitchId: video.pitchId,
        isStandalone: false,
        format: video.format,
        nextVideoId,
        previousVideoId,
        videoCount: lesson.videos.length,
        hasExplainerFolder: false,
        clipMockupCount,
      };
    }),
});

type Tab =
  | "edit"
  | "animatic"
  | "lesson"
  | "post"
  | "social"
  | "ai-hero"
  | "skills-changelog"
  | "newsletter";

const topTabsDef: {
  id: "edit" | "post";
  label: string;
  path: string | ((lessonId: string | null) => string);
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "edit", label: "Video", path: "edit", icon: VideoIcon },
  {
    id: "post",
    label: "Post",
    path: (lessonId) => (lessonId ? "lesson" : "post"),
    icon: SendIcon,
  },
];

const isPostTab = (tab: Tab): boolean =>
  tab === "lesson" ||
  tab === "post" ||
  tab === "social" ||
  tab === "ai-hero" ||
  tab === "skills-changelog" ||
  tab === "newsletter";

export default function VideoLayout({ loaderData }: Route.ComponentProps) {
  const {
    videoId,
    videoTitle,
    videoFormat,
    lessonPath,
    sectionPath,
    repoId,
    lessonId,
    sectionId,
    pitchId,
    isStandalone,
    format,
    nextVideoId,
    previousVideoId,
    videoCount,
    hasExplainerFolder,
  } = loaderData;

  const location = useLocation();
  const [addVideoModalOpen, setAddVideoModalOpen] = useState(false);

  const subTabs = useMemo(() => postSubTabs({ isStandalone }), [isStandalone]);

  const topTabs = useMemo(
    () =>
      topTabsDef.map((t) => ({
        ...t,
        path: typeof t.path === "function" ? t.path(lessonId) : t.path,
      })),
    [lessonId]
  );

  // Determine active tab from current path
  const activeTab: Tab = location.pathname.endsWith("/animatic")
    ? "animatic"
    : location.pathname.endsWith("/lesson")
      ? "lesson"
      : location.pathname.endsWith("/post")
        ? "post"
        : location.pathname.endsWith("/social")
          ? "social"
          : location.pathname.endsWith("/ai-hero")
            ? "ai-hero"
            : location.pathname.endsWith("/skills-changelog")
              ? "skills-changelog"
              : location.pathname.endsWith("/newsletter")
                ? "newsletter"
                : "edit";

  const backButtonUrl = getBackButtonUrl(repoId, lessonId, format, pitchId);

  // The Video's menu on the breadcrumb, for every tab outside the editor (the
  // editor's own breadcrumb carries its fuller list). Only what this page
  // knows enough to run.
  const navigate = useNavigate();
  const submit = useSubmit();
  const revealFetcher = useFetcher();
  const { startExportUpload } = useUploadActions();
  const dialogs = useVideoDialogs();
  const video = { id: videoId, title: videoTitle };
  const videoGroups = videoMenuGroups({
    revealInFileSystem: () =>
      revealFetcher.submit(
        {},
        { method: "post", action: `/api/videos/${videoId}/reveal` }
      ),
    rename: () => dialogs.rename(video),
    moveToCourse:
      isStandalone && videoFormat !== "short"
        ? () => navigate(`/videos/${videoId}/move-to-course`)
        : undefined,
    export: () => startExportUpload(videoId, videoTitle),
    archive: () => {
      void submit(
        { videoId },
        { method: "post", action: "/api/videos/delete", navigate: false }
      );
      void navigate(backButtonUrl);
    },
  });

  // Build breadcrumb text
  const breadcrumb = formatVideoBreadcrumb({
    isStandalone,
    sectionPath,
    lessonPath,
    videoTitle,
  });

  // Every link copied on this Video's pages names its Course, Section and
  // Lesson too.
  const findLessonPlace = useCallback<FindLessonPlace>(
    (id) =>
      id === videoId && repoId && sectionId && lessonId
        ? { courseId: repoId, sectionId, lessonId }
        : undefined,
    [videoId, repoId, sectionId, lessonId]
  );

  const matches = useMatches();
  const hideParentHeader = matches.some(
    (m) =>
      (m.handle as { hideParentHeader?: boolean } | undefined)?.hideParentHeader
  );

  return (
    <LessonPlaceProvider value={findLessonPlace}>
      <div className="h-screen flex flex-col">
        {!hideParentHeader && (
          <>
            {/* Shared header */}
            <div className="flex items-center gap-2 p-4 border-b justify-between">
              <div className="flex items-center gap-2">
                {/* Back button */}
                <Button variant="ghost" size="icon" asChild>
                  <Link to={backButtonUrl}>
                    <ChevronLeftIcon className="size-6" />
                  </Link>
                </Button>

                {/* Breadcrumb — right-click it for this Video's menu, on every
                  tab of the Video. */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <h1 className="text-lg cursor-context-menu">
                      {breadcrumb}
                    </h1>
                  </ContextMenuTrigger>
                  <EntityMenuContent
                    menu="context"
                    entity={{ type: "video", id: videoId }}
                    groups={videoGroups}
                  />
                </ContextMenu>
              </div>

              <div className="flex items-center gap-4">
                {/* Into the Animatic, which is now a page of this Video like any
                  other: a `Link`, in this tab, beside the tab switcher. Shown
                  for every Landscape Video — a Short has no Animatic, but a
                  Video with no Clip Mockups yet has an empty state that says
                  how they are authored, which is worth reaching. */}
                {videoFormat !== "short" && (
                  <Link
                    to={`/videos/${videoId}/animatic`}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                      activeTab === "animatic"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <PlayIcon className="size-4" />
                    Animatic
                  </Link>
                )}

                {/* Top-level tab switcher (hidden for short-format videos) */}
                {videoFormat !== "short" && (
                  <div className="flex gap-1">
                    {topTabs.map((tab) => {
                      const isActive =
                        tab.id === "post"
                          ? isPostTab(activeTab)
                          : activeTab === tab.id;
                      return (
                        <Link
                          key={tab.id}
                          to={`/videos/${videoId}/${tab.path}`}
                          className={cn(
                            "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5",
                            isActive
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <tab.icon className="size-4" />
                          {tab.label}
                        </Link>
                      );
                    })}
                  </div>
                )}

                {/* Navigation buttons */}
                <div className="flex items-center gap-2">
                  {previousVideoId ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/videos/${previousVideoId}/${activeTab}`}>
                        <ChevronLeftIcon className="size-4 mr-1" />
                        Previous
                      </Link>
                    </Button>
                  ) : null}
                  {nextVideoId ? (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/videos/${nextVideoId}/${activeTab}`}>
                            Next
                            <ChevronRightIcon className="size-4 ml-1" />
                          </Link>
                        </Button>
                      </ContextMenuTrigger>
                      {/* The next Video belongs to this Lesson: its menu is the
                        Lesson's. */}
                      {lessonId && repoId && sectionId && (
                        <EntityMenuContent
                          menu="context"
                          entity={{
                            type: "lesson",
                            id: lessonId,
                            courseId: repoId,
                            sectionId,
                          }}
                          groups={{
                            create: [
                              {
                                ...STANDARD_ACTIONS.add,
                                label: "Add Video",
                                opensDialog: true,
                                onSelect: () => setAddVideoModalOpen(true),
                              },
                            ],
                          }}
                        />
                      )}
                    </ContextMenu>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Post sub-tabs */}
            {isPostTab(activeTab) && (
              <div className="flex gap-1 px-4 py-2 border-b">
                {subTabs.map((tab) => (
                  <Link
                    key={tab.id}
                    to={`/videos/${videoId}/${tab.path}`}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5",
                      activeTab === tab.id
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <tab.icon className="size-4" />
                    {tab.label}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {/* Child route content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>

        {dialogs.dialogs}

        <AddVideoModal
          lessonId={lessonId ?? undefined}
          videoCount={videoCount}
          hasExplainerFolder={hasExplainerFolder}
          open={addVideoModalOpen}
          onOpenChange={setAddVideoModalOpen}
        />
      </div>
    </LessonPlaceProvider>
  );
}
