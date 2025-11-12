"use client";

import { AddRepoModal } from "@/components/add-repo-modal";
import { AddVideoModal } from "@/components/add-video-modal";
import { EditLessonModal } from "@/components/edit-lesson-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { VideoModal } from "@/components/video-player";
import { getVideoPath } from "@/lib/get-video";
import { cn } from "@/lib/utils";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { formatSecondsToTimeCode } from "@/services/utils";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import {
  ChevronDown,
  Download,
  FolderGit2,
  Loader2,
  PencilIcon,
  Play,
  Plus,
  Send,
  Trash2,
  VideoIcon,
  VideoOffIcon,
  VideotapeIcon,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";

export const meta: Route.MetaFunction = ({ data }) => {
  const selectedRepo = data?.selectedRepo;

  if (selectedRepo) {
    return [
      {
        title: `CVM - ${selectedRepo.name}`,
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
  const selectedRepoId = url.searchParams.get("repoId");

  return Effect.gen(function* () {
    const db = yield* DBService;
    const fs = yield* FileSystem.FileSystem;
    const [repos, selectedRepo] = yield* Effect.all(
      [
        db.getRepos(),
        !selectedRepoId
          ? Effect.succeed(undefined)
          : db.getRepoWithSectionsById(selectedRepoId).pipe(
              Effect.andThen((repo) => {
                if (!repo) {
                  return undefined;
                }

                return {
                  ...repo,
                  sections: repo.sections
                    .filter((section) => {
                      return !section.path.endsWith("ARCHIVE");
                    })
                    .filter((section) => section.lessons.length > 0),
                };
              })
            ),
      ],
      {
        concurrency: "unbounded",
      }
    );

    const hasExportedVideoMap: Record<string, boolean> = {};

    const videos = selectedRepo?.sections.flatMap((section) =>
      section.lessons.flatMap((lesson) => lesson.videos)
    );

    yield* Effect.forEach(videos ?? [], (video) => {
      return Effect.gen(function* () {
        const hasExportedVideo = yield* fs.exists(getVideoPath(video.id));

        hasExportedVideoMap[video.id] = hasExportedVideo;
      });
    });

    // Check for explainer folder in each lesson
    const hasExplainerFolderMap: Record<string, boolean> = {};

    const lessons =
      selectedRepo?.sections.flatMap((section) =>
        section.lessons.map((lesson) => ({
          id: lesson.id,
          fullPath: `${selectedRepo.filePath}/${section.path}/${lesson.path}`,
        }))
      ) ?? [];

    yield* Effect.forEach(lessons, (lesson) => {
      return Effect.gen(function* () {
        const explainerPath = `${lesson.fullPath}/explainer`;
        const hasExplainerFolder = yield* fs.exists(explainerPath);

        hasExplainerFolderMap[lesson.id] = hasExplainerFolder;
      });
    });

    return { repos, selectedRepo, hasExportedVideoMap, hasExplainerFolderMap };
  }).pipe(
    Effect.catchTag("NotFoundError", (_e) => {
      return Effect.succeed(new Response("Not Found", { status: 404 }));
    }),
    Effect.provide(layerLive),
    Effect.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRepoId = searchParams.get("repoId");
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [addVideoToLessonId, setAddVideoToLessonId] = useState<string | null>(
    null
  );
  const [editLessonId, setEditLessonId] = useState<string | null>(null);
  const [videoPlayerState, setVideoPlayerState] = useState<{
    isOpen: boolean;
    videoId: string;
    videoPath: string;
  }>({
    isOpen: false,
    videoId: "",
    videoPath: "",
  });

  const publishRepoFetcher = useFetcher();
  const exportUnexportedFetcher = useFetcher();

  const poller = useFetcher<typeof props.loaderData>();

  useEffect(() => {
    if (!selectedRepoId) {
      return;
    }

    const abortController = new AbortController();

    const submit = () => {
      poller.submit(
        {
          repoId: selectedRepoId,
        },
        {
          method: "GET",
          preventScrollReset: true,
        }
      );
    };

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") {
          submit();
        }
      },
      {
        signal: abortController.signal,
      }
    );

    const interval = setInterval(() => {
      submit();
    }, 5000);

    return () => {
      clearInterval(interval);
      abortController.abort();
    };
  }, [selectedRepoId]);

  const deleteVideoFetcher = useFetcher();
  const deleteLessonFetcher = useFetcher();

  const data = poller.data ?? props.loaderData;

  const repos = data.repos;

  const currentRepo = data.selectedRepo;

  const totalLessonsWithVideos =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter((lesson) => lesson.videos.length > 0).length
      );
    }, 0) ?? 0;

  const totalLessons =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return acc + section.lessons.length;
    }, 0) ?? 0;

  const totalVideos =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.reduce((lessonAcc, lesson) => {
          return lessonAcc + lesson.videos.length;
        }, 0)
      );
    }, 0) ?? 0;

  const percentageComplete =
    totalLessons > 0
      ? Math.round((totalLessonsWithVideos / totalLessons) * 100)
      : 0;

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left Sidebar - Repos */}
      <div className="w-80 border-r bg-muted/30 hidden lg:block flex flex-col">
        <div className="p-4 flex-1 flex flex-col min-h-0">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FolderGit2 className="w-5 h-5" />
            Repos
          </h2>
          <Link to="/diagram-playground">
            <Button variant="outline" className="w-full mb-4">
              Diagram Playground
            </Button>
          </Link>
          <ScrollArea className="flex-1 mb-4">
            <div className="space-y-2 pr-4">
              {repos.map((repo) => (
                <Button
                  key={repo.id}
                  variant={selectedRepoId === repo.id ? "default" : "ghost"}
                  className={cn(
                    "w-full justify-start whitespace-normal text-left h-auto",
                    selectedRepoId === repo.id &&
                      "bg-muted text-foreground/90 hover:bg-muted/90"
                  )}
                  onClick={() => {
                    setSearchParams({ repoId: repo.id });
                  }}
                >
                  {repo.name}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <Separator className="mb-4" />
          <AddRepoModal
            isOpen={isAddRepoModalOpen}
            onOpenChange={setIsAddRepoModalOpen}
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {currentRepo ? (
            <>
              <div className="flex gap-6">
                <div>
                  <h1 className="text-2xl font-bold mb-2">
                    {currentRepo.name}
                  </h1>
                  <div className="flex items-center gap-2 mb-8">
                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      {totalLessonsWithVideos} / {totalLessons} lessons ({percentageComplete}%)
                    </span>
                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      {totalVideos} videos
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        disabled={
                          exportUnexportedFetcher.state === "submitting" ||
                          publishRepoFetcher.state === "submitting"
                        }
                      >
                        {exportUnexportedFetcher.state === "submitting" ||
                        publishRepoFetcher.state === "submitting" ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : null}
                        Actions
                        <ChevronDown className="w-4 h-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem
                        onSelect={() => {
                          exportUnexportedFetcher.submit(
                            {},
                            {
                              method: "post",
                              action: `/api/repos/${currentRepo.id}/export-unexported`,
                            }
                          );
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Export</span>
                          <span className="text-xs text-muted-foreground">
                            Export videos not yet exported
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          publishRepoFetcher.submit(
                            { repoId: currentRepo.id },
                            {
                              method: "post",
                              action: "/api/repos/publish",
                            }
                          );
                        }}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Publish</span>
                          <span className="text-xs text-muted-foreground">
                            Copy all files to Dropbox
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-x-18 gap-y-12">
                {currentRepo.sections.map((section) => {
                  const sectionDuration = section.lessons.reduce(
                    (acc, lesson) => {
                      return (
                        acc +
                        lesson.videos.reduce((videoAcc, video) => {
                          return (
                            videoAcc +
                            video.clips.reduce((clipAcc, clip) => {
                              return (
                                clipAcc +
                                (clip.sourceEndTime - clip.sourceStartTime)
                              );
                            }, 0)
                          );
                        }, 0)
                      );
                    },
                    0
                  );

                  return (
                    <div key={section.id} className="">
                      <h2 className="mb-4 text-foreground text-lg font-semibold tracking-tight">
                        {section.path} (
                        {formatSecondsToTimeCode(sectionDuration)})
                      </h2>
                      {section.lessons.map((lesson, index, arr) => (
                        <React.Fragment key={lesson.id}>
                          <a id={lesson.id} />
                          <div
                            key={lesson.id}
                            className={cn(
                              "text-foreground",
                              arr[index - 1]?.videos.length === 0
                                ? "border border-t-0"
                                : "border"
                            )}
                          >
                            <div className="flex items-center justify-between px-3 py-2">
                              <h3 className="text-sm tracking-wide">
                                {lesson.path}
                              </h3>
                              <div className="flex items-center space-x-2">
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-xs"
                                  onClick={() =>
                                    setAddVideoToLessonId(lesson.id)
                                  }
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                                <AddVideoModal
                                  lessonId={lesson.id}
                                  videoCount={lesson.videos.length}
                                  hasExplainerFolder={
                                    data.hasExplainerFolderMap[lesson.id] ??
                                    false
                                  }
                                  open={addVideoToLessonId === lesson.id}
                                  onOpenChange={(open) => {
                                    setAddVideoToLessonId(
                                      open ? lesson.id : null
                                    );
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-xs"
                                  onClick={() => setEditLessonId(lesson.id)}
                                >
                                  <PencilIcon className="w-4 h-4" />
                                </Button>
                                <EditLessonModal
                                  lessonId={lesson.id}
                                  currentPath={lesson.path}
                                  open={editLessonId === lesson.id}
                                  onOpenChange={(open) => {
                                    setEditLessonId(open ? lesson.id : null);
                                  }}
                                />
                                <deleteLessonFetcher.Form
                                  method="post"
                                  action="/api/lessons/delete"
                                  className="block"
                                >
                                  <input
                                    type="hidden"
                                    name="lessonId"
                                    value={lesson.id}
                                  />
                                  <Button
                                    type="submit"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-xs"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </deleteLessonFetcher.Form>
                              </div>
                            </div>
                          </div>
                          {lesson.videos.length > 0 && (
                            <div className="ml-8 text-foreground">
                              {lesson.videos.map((video, index) => {
                                const totalDuration = video.clips.reduce(
                                  (acc, clip) => {
                                    return (
                                      acc +
                                      (clip.sourceEndTime -
                                        clip.sourceStartTime)
                                    );
                                  },
                                  0
                                );

                                return (
                                  <div
                                    key={video.id}
                                    className={cn(
                                      "flex items-center justify-between text-sm border-x px-3 py-2",
                                      index !== 0 ? "border-t" : ""
                                    )}
                                  >
                                    <div className="flex items-center">
                                      {data.hasExportedVideoMap[video.id] ? (
                                        <VideoIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                                      ) : (
                                        <VideoOffIcon className="w-4 h-4 mr-2 text-red-500 flex-shrink-0" />
                                      )}
                                      <span className="tracking-wide">
                                        {video.path} (
                                        {formatSecondsToTimeCode(totalDuration)}
                                        )
                                      </span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        asChild
                                      >
                                        <Link to={`/videos/${video.id}/edit`}>
                                          <VideotapeIcon className="w-4 h-4" />
                                        </Link>
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        asChild
                                      >
                                        <Link to={`/videos/${video.id}/write`}>
                                          <PencilIcon className="w-4 h-4 flex-shrink-0" />
                                        </Link>
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={() => {
                                          setVideoPlayerState({
                                            isOpen: true,
                                            videoId: video.id,
                                            videoPath: `${section.path}/${lesson.path}/${video.path}`,
                                          });
                                        }}
                                      >
                                        <Play className="w-4 h-4" />
                                      </Button>
                                      <deleteVideoFetcher.Form
                                        method="post"
                                        action="/api/videos/delete"
                                        className="inline"
                                      >
                                        <input
                                          type="hidden"
                                          name="videoId"
                                          value={video.id}
                                        />
                                        <Button
                                          type="submit"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      </deleteVideoFetcher.Form>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="mb-8">
                <h1 className="text-2xl font-bold mb-2">
                  Course Video Manager
                </h1>
                <p className="text-sm text-muted-foreground">
                  Select a repository
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {repos.map((repo) => (
                  <Link
                    key={repo.id}
                    to={`?repoId=${repo.id}`}
                    className="block border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold">{repo.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {repo.filePath}
                    </p>
                  </Link>
                ))}
              </div>

              {repos.length === 0 && (
                <div className="text-center py-12">
                  <div className="mb-4">
                    <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground/50" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    No repositories found
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    Get started by adding your first repository
                  </p>
                  <Button
                    onClick={() => setIsAddRepoModalOpen(true)}
                    className="mx-auto"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Repository
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <VideoModal
        videoId={videoPlayerState.videoId}
        videoPath={videoPlayerState.videoPath}
        isOpen={videoPlayerState.isOpen}
        onClose={() => {
          setVideoPlayerState({
            isOpen: false,
            videoId: "",
            videoPath: "",
          });
        }}
      />
    </div>
  );
}
