import { AddVideoModal } from "@/components/add-video-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Plus,
  VideoIcon,
  PenIcon,
  SendIcon,
  YoutubeIcon,
  NewspaperIcon,
  MailIcon,
  HistoryIcon,
} from "lucide-react";
import { useState } from "react";
import { data, Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const video = yield* videoOps.getVideoWithLessonById(videoId);

    const [nextVideoId, previousVideoId] = yield* Effect.all([
      videoOps.getNextVideoId(video),
      videoOps.getPreviousVideoId(video),
    ]);

    const lesson = video.lesson;

    if (!lesson) {
      // Standalone video (or pitch-attached)
      return {
        videoId,
        videoPath: video.path,
        lessonPath: null,
        sectionPath: null,
        repoId: null,
        lessonId: null,
        pitchId: video.pitchId,
        isStandalone: true,
        nextVideoId,
        previousVideoId,
        videoCount: 1,
        hasExplainerFolder: false,
      };
    }

    const hasExplainerFolder = yield* fs.exists(
      `${lesson.section.repoVersion.repo.filePath}/${lesson.section.path}/${lesson.path}/explainer`
    );

    // Lesson-attached video
    return {
      videoId,
      videoPath: video.path,
      lessonPath: lesson.path,
      sectionPath: lesson.section.path,
      repoId: lesson.section.repoVersion.repoId,
      lessonId: lesson.id,
      pitchId: video.pitchId,
      isStandalone: false,
      nextVideoId,
      previousVideoId,
      videoCount: lesson.videos.length,
      hasExplainerFolder,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

type Tab =
  | "edit"
  | "write"
  | "post"
  | "social"
  | "ai-hero"
  | "skills-changelog"
  | "newsletter";

const topTabs: {
  id: "edit" | "write" | "post";
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "edit", label: "Video", path: "edit", icon: VideoIcon },
  { id: "write", label: "Write", path: "write", icon: PenIcon },
  { id: "post", label: "Post", path: "post", icon: SendIcon },
];

const postSubTabs: {
  id: Tab;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
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
  tab === "post" ||
  tab === "social" ||
  tab === "ai-hero" ||
  tab === "skills-changelog" ||
  tab === "newsletter";

export default function VideoLayout({ loaderData }: Route.ComponentProps) {
  const {
    videoId,
    videoPath,
    lessonPath,
    sectionPath,
    repoId,
    lessonId,
    pitchId,
    isStandalone,
    nextVideoId,
    previousVideoId,
    videoCount,
    hasExplainerFolder,
  } = loaderData;

  const location = useLocation();
  const [addVideoModalOpen, setAddVideoModalOpen] = useState(false);

  // Determine active tab from current path
  const activeTab: Tab = location.pathname.endsWith("/write")
    ? "write"
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

  // Build back button URL
  const backButtonUrl = pitchId
    ? `/pitches/${pitchId}`
    : repoId && lessonId
      ? `/courses/${repoId}#${lessonId}`
      : "/videos";

  // Build breadcrumb text
  const breadcrumb = isStandalone
    ? videoPath
    : `${sectionPath}/${lessonPath}/${videoPath}`;

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
