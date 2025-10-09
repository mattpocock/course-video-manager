"use client";

import { AddRepoModal } from "@/components/add-repo-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { homedir } from "node:os";
import path from "node:path";
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

    return { repos, selectedRepo, hasExportedVideoMap };
  }).pipe(
    Effect.catchTag("NotFoundError", (e) => {
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

  const addVideoFetcher = useFetcher();

  const deleteVideoFetcher = useFetcher();
  const deleteLessonFetcher = useFetcher();

  const data = poller.data ?? props.loaderData;

  const repos = data.repos;

  const currentRepo = data.selectedRepo;

  // Function to determine the path based on video count
  const getVideoPath = (lesson: { videos: unknown[] }) => {
    const videoCount = lesson.videos.length;

    if (videoCount === 0) {
      return "Problem";
    } else if (videoCount === 1) {
      return "Solution";
    } else {
      return `Solution ${videoCount}`;
    }
  };

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

  const percentageComplete =
    totalLessons > 0
      ? Math.round((totalLessonsWithVideos / totalLessons) * 100)
      : 0;

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left Sidebar - Repos */}
      <div className="w-80 border-r bg-muted/30 hidden lg:block">
        <div className="p-4 pb-0">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FolderGit2 className="w-5 h-5" />
            Repos
          </h2>
          <ScrollArea className="h-[calc(100vh-120px)]">
            <div className="space-y-2">
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
          <Separator className="mb-4 -mt-4" />
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
                  <p className="text-sm text-muted-foreground mb-8">
                    {totalLessonsWithVideos} / {totalLessons} lessons with
                    recordings ({percentageComplete}%)
                  </p>
                </div>
                <publishRepoFetcher.Form
                  method="post"
                  action="/api/repos/publish"
                >
                  <input type="hidden" name="repoId" value={currentRepo.id} />
                  <Button type="submit">
                    {publishRepoFetcher.state === "submitting" ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-1" />
                    )}
                    <span className="hidden md:block">Publish</span>
                  </Button>
                </publishRepoFetcher.Form>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-x-18 gap-y-12">
                {currentRepo.sections.map((section) => (
                  <div key={section.id} className="">
                    <h2 className="mb-4 text-foreground text-lg font-semibold tracking-tight">
                      {section.path}
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
                              <Dialog
                                open={addVideoToLessonId === lesson.id}
                                onOpenChange={(open) => {
                                  setAddVideoToLessonId(
                                    open ? lesson.id : null
                                  );
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    type="submit"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-xs"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-md">
                                  <DialogHeader>
                                    <DialogTitle>Add New Video</DialogTitle>
                                  </DialogHeader>
                                  <addVideoFetcher.Form
                                    method="post"
                                    action={`/api/lessons/${lesson.id}/add-video`}
                                    className="space-y-4 py-4"
                                    onSubmit={async (e) => {
                                      e.preventDefault();
                                      await addVideoFetcher.submit(
                                        e.currentTarget
                                      );
                                      setAddVideoToLessonId(null);
                                    }}
                                  >
                                    <input
                                      type="hidden"
                                      name="lessonId"
                                      value={lesson.id}
                                    />
                                    <div className="space-y-2">
                                      <Label htmlFor="video-path">
                                        Video Name
                                      </Label>
                                      <Input
                                        id="video-path"
                                        placeholder="Problem, Solution, Explainer..."
                                        defaultValue={getVideoPath(lesson)}
                                        name="path"
                                      />
                                    </div>
                                    <div className="flex justify-end space-x-2">
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          setAddVideoToLessonId(null)
                                        }
                                        type="button"
                                      >
                                        Cancel
                                      </Button>
                                      <Button type="submit">
                                        {addVideoFetcher.state ===
                                        "submitting" ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          "Add Video"
                                        )}
                                      </Button>
                                    </div>
                                  </addVideoFetcher.Form>
                                </DialogContent>
                              </Dialog>
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
                                    (clip.sourceEndTime - clip.sourceStartTime)
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
                                      {formatSecondsToTimeCode(totalDuration)})
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
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={() => {}}
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
                ))}
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
