import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { DeleteVideoModal } from "@/components/delete-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { formatSecondsToTimeCode } from "@/services/utils";
import { CoursePublishService } from "@/services/course-publish-service";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import {
  Archive,
  ArrowRightLeft,
  Download,
  FileX,
  FolderOpen,
  PencilIcon,
  Combine,
  Plus,
  Trash2,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";
import { useContext, useState } from "react";
import { data, Link, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/_app.videos._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Videos" }];
};

export const loader = async () => {
  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const publishService = yield* CoursePublishService;

    const [videos, archivedVideos] = yield* Effect.all(
      [
        videoOps.getAllStandaloneVideos(),
        videoOps.getArchivedStandaloneVideos(),
      ],
      { concurrency: "unbounded" }
    );

    // Check export status for each video
    const hasExportedVideoMap: Record<string, boolean> = {};
    yield* Effect.forEach([...videos, ...archivedVideos], (video) => {
      return Effect.gen(function* () {
        hasExportedVideoMap[video.id] = yield* publishService.isExported(video);
      });
    });

    return {
      videos,
      archivedVideos,
      hasExportedVideoMap,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const { videos, archivedVideos, hasExportedVideoMap } = props.loaderData;
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const [videoToRename, setVideoToRename] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const navigate = useNavigate();
  const archiveVideoFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const deleteVideoFileFetcher = useFetcher();
  const { startExportUpload } = useContext(UploadContext);

  useFocusRevalidate({ enabled: true });

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <VideoIcon className="w-6 h-6" />
              Standalone Videos
            </h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate("/videos/concatenate")}
              >
                Concatenate
              </Button>
              <Button onClick={() => setIsAddVideoOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Video
              </Button>
            </div>
          </div>

          {videoToDelete && (
            <DeleteVideoModal
              videoId={videoToDelete.id}
              videoPath={videoToDelete.path}
              open={true}
              onOpenChange={(open) => {
                if (!open) setVideoToDelete(null);
              }}
            />
          )}

          {videoToRename && (
            <RenameVideoModal
              videoId={videoToRename.id}
              currentName={videoToRename.path}
              open={true}
              onOpenChange={(open) => {
                if (!open) setVideoToRename(null);
              }}
            />
          )}

          {videos.length === 0 ? (
            <div className="text-center py-12">
              <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                No standalone videos
              </h3>
              <p className="text-muted-foreground">
                Standalone videos are videos not attached to any lesson.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {videos.map((video) => {
                const totalDuration = video.clips.reduce((acc, clip) => {
                  return acc + (clip.sourceEndTime - clip.sourceStartTime);
                }, 0);

                return (
                  <ContextMenu key={video.id}>
                    <ContextMenuTrigger asChild>
                      <Link
                        to={`/videos/${video.id}/edit`}
                        className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-context-menu"
                      >
                        <div className="flex items-center gap-3">
                          {hasExportedVideoMap[video.id] ? (
                            <VideoIcon className="w-5 h-5 flex-shrink-0" />
                          ) : (
                            <VideoOffIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                          )}
                          <span className="font-medium">{video.path}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {formatSecondsToTimeCode(totalDuration)}
                        </span>
                      </Link>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => {
                          setVideoToRename({ id: video.id, path: video.path });
                        }}
                      >
                        <PencilIcon className="w-4 h-4" />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          startExportUpload(video.id, video.path);
                        }}
                      >
                        <Download className="w-4 h-4" />
                        Export
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          navigate(`/videos/concatenate?initial=${video.id}`);
                        }}
                      >
                        <Combine className="w-4 h-4" />
                        Create Concatenated Video
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          revealVideoFetcher.submit(
                            {},
                            {
                              method: "post",
                              action: `/api/videos/${video.id}/reveal`,
                            }
                          );
                        }}
                      >
                        <FolderOpen className="w-4 h-4" />
                        Reveal in File System
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          navigate(`/videos/${video.id}/move-to-course`);
                        }}
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        Move to Course
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          archiveVideoFetcher.submit(
                            { archived: "true" },
                            {
                              method: "post",
                              action: `/api/videos/${video.id}/archive`,
                            }
                          );
                        }}
                      >
                        <Archive className="w-4 h-4" />
                        Archive
                      </ContextMenuItem>
                      {hasExportedVideoMap[video.id] && (
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => {
                            deleteVideoFileFetcher.submit(
                              {},
                              {
                                method: "post",
                                action: `/api/videos/${video.id}/purge-export`,
                              }
                            );
                          }}
                        >
                          <FileX className="w-4 h-4" />
                          Purge Export
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => {
                          setVideoToDelete({ id: video.id, path: video.path });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}

          {archivedVideos.length > 0 && (
            <div className="mt-12">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Archive className="w-5 h-5" />
                Archived Videos
              </h2>
              <div className="space-y-2">
                {archivedVideos.map((video) => {
                  const totalDuration = video.clips.reduce((acc, clip) => {
                    return acc + (clip.sourceEndTime - clip.sourceStartTime);
                  }, 0);

                  return (
                    <ContextMenu key={video.id}>
                      <ContextMenuTrigger asChild>
                        <Link
                          to={`/videos/${video.id}/edit`}
                          className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-context-menu"
                        >
                          <div className="flex items-center gap-3">
                            {hasExportedVideoMap[video.id] ? (
                              <VideoIcon className="w-5 h-5 flex-shrink-0" />
                            ) : (
                              <VideoOffIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                            )}
                            <span className="font-medium">{video.path}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {formatSecondsToTimeCode(totalDuration)}
                          </span>
                        </Link>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            setVideoToRename({
                              id: video.id,
                              path: video.path,
                            });
                          }}
                        >
                          <PencilIcon className="w-4 h-4" />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            startExportUpload(video.id, video.path);
                          }}
                        >
                          <Download className="w-4 h-4" />
                          Export
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            navigate(`/videos/concatenate?initial=${video.id}`);
                          }}
                        >
                          <Combine className="w-4 h-4" />
                          Create Concatenated Video
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            revealVideoFetcher.submit(
                              {},
                              {
                                method: "post",
                                action: `/api/videos/${video.id}/reveal`,
                              }
                            );
                          }}
                        >
                          <FolderOpen className="w-4 h-4" />
                          Reveal in File System
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            archiveVideoFetcher.submit(
                              { archived: "false" },
                              {
                                method: "post",
                                action: `/api/videos/${video.id}/archive`,
                              }
                            );
                          }}
                        >
                          <Archive className="w-4 h-4" />
                          Unarchive
                        </ContextMenuItem>
                        {hasExportedVideoMap[video.id] && (
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => {
                              deleteVideoFileFetcher.submit(
                                {},
                                {
                                  method: "post",
                                  action: `/api/videos/${video.id}/purge-export`,
                                }
                              );
                            }}
                          >
                            <FileX className="w-4 h-4" />
                            Purge Export
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setVideoToDelete({
                              id: video.id,
                              path: video.path,
                            });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <AddStandaloneVideoModal
        open={isAddVideoOpen}
        onOpenChange={setIsAddVideoOpen}
      />
    </div>
  );
}
