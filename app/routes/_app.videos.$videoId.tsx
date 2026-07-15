import { AddVideoModal } from "@/components/add-video-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getBackButtonUrl } from "@/features/video-editor/video-editor-selectors";
import { cn } from "@/lib/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Plus,
  VideoIcon,
  SendIcon,
  YoutubeIcon,
  NewspaperIcon,
  MailIcon,
  HistoryIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);

      const [nextVideoId, previousVideoId] = yield* Effect.all([
        videoOps.getNextVideoId(video),
        videoOps.getPreviousVideoId(video),
      ]);

      const lesson = video.lesson;

      if (!lesson) {
        return {
          videoId,
          videoTitle: video.title,
          lessonPath: null,
          sectionPath: null,
          repoId: null,
          lessonId: null,
          pitchId: video.pitchId,
          isStandalone: true,
          format: video.format,
          nextVideoId,
          previousVideoId,
          videoCount: 1,
          hasExplainerFolder: false,
        };
      }

      return {
        videoId,
        videoTitle: video.title,
        lessonPath: lesson.title,
        sectionPath: lesson.section.title,
        repoId: lesson.section.repoVersion.repoId,
        lessonId: lesson.id,
        pitchId: video.pitchId,
        isStandalone: false,
        format: video.format,
        nextVideoId,
        previousVideoId,
        videoCount: lesson.videos.length,
        hasExplainerFolder: false,
      };
    }),
});

type Tab =
  | "edit"
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

type PostSubTab = {
  id: Tab;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

const lessonTab: PostSubTab = {
  id: "lesson",
  label: "Lesson",
  path: "lesson",
  icon: BookOpenIcon,
};

const commonPostSubTabs: PostSubTab[] = [
  { id: "post", label: "YouTube", path: "post", icon: YoutubeIcon },
  { id: "social", label: "X / LinkedIn", path: "social", icon: SendIcon },
  { id: "ai-hero", label: "AI Hero", path: "ai-hero", icon: NewspaperIcon },
  {
    id: "skills-changelog",
    label: "Skills Changelog",
    path: "skills-changelog",
    icon: HistoryIcon,
  },
  { id: "newsletter", label: "Newsletter", path: "newsletter", icon: MailIcon },
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
    lessonPath,
    sectionPath,
    repoId,
    lessonId,
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

  const postSubTabs = useMemo(
    () => (lessonId ? [lessonTab, ...commonPostSubTabs] : commonPostSubTabs),
    [lessonId]
  );

  const topTabs = useMemo(
    () =>
      topTabsDef.map((t) => ({
        ...t,
        path: typeof t.path === "function" ? t.path(lessonId) : t.path,
      })),
    [lessonId]
  );

  // Determine active tab from current path
  const activeTab: Tab = location.pathname.endsWith("/lesson")
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

  // Build breadcrumb text
  const breadcrumb = isStandalone
    ? videoTitle
    : `${sectionPath}/${lessonPath}/${videoTitle}`;

  return (
    <div className="h-screen flex flex-col">
      {/* Shared header */}
      <div className="flex items-center gap-2 p-4 border-b justify-between">
        <div className="flex items-center gap-2">
          {/* Back button */}
          <Button variant="ghost" size="icon" asChild>
            <Link to={backButtonUrl}>
              <ChevronLeftIcon className="size-6" />
            </Link>
          </Button>

          {/* Breadcrumb */}
          <h1 className="text-lg">{breadcrumb}</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Top-level tab switcher */}
          <div className="flex gap-1">
            {topTabs.map((tab) => {
              const isActive =
                tab.id === "post" ? isPostTab(activeTab) : activeTab === tab.id;
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
                {lessonId && (
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => setAddVideoModalOpen(true)}
                    >
                      <Plus className="w-4 h-4" />
                      Add New Video
                    </ContextMenuItem>
                  </ContextMenuContent>
                )}
              </ContextMenu>
            ) : null}
          </div>
        </div>
      </div>

      {/* Post sub-tabs */}
      {isPostTab(activeTab) && (
        <div className="flex gap-1 px-4 py-2 border-b">
          {postSubTabs.map((tab) => (
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

      {/* Child route content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>

      <AddVideoModal
        lessonId={lessonId ?? undefined}
        videoCount={videoCount}
        hasExplainerFolder={hasExplainerFolder}
        open={addVideoModalOpen}
        onOpenChange={setAddVideoModalOpen}
      />
    </div>
  );
}
