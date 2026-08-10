"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/_app.videos.$videoId.post";
import { VideoContextPanel } from "@/components/video-context-panel";
import { CoursePublishService } from "@/services/course-publish-service";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { VideoFileManagementModal } from "@/components/video-file-management-modal";
import { VideoFilePasteModal } from "@/components/video-file-paste-modal";
import { DeleteVideoFileModal } from "@/components/delete-video-file-modal";
import { VideoOffIcon } from "lucide-react";
import { PostPage } from "@/features/video-posting/post-page";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const ctx = yield* loadVideoPostingContext(videoId);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const pitchOps = yield* PitchOperationsService;
      const publishService = yield* CoursePublishService;

      const [youtubeAuth, videoThumbnails, videoExists] = yield* Effect.all(
        [
          linkAuthOps.getYoutubeAuth(),
          thumbnailOps.getThumbnailsByVideoId(videoId),
          publishService.isExported(videoId),
        ],
        { concurrency: "unbounded" }
      );

      const pitch = ctx.pitchId
        ? yield* pitchOps
            .getPitch(ctx.pitchId)
            .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)))
        : null;

      return {
        ...ctx,
        videoExists,
        isYoutubeAuthenticated: youtubeAuth !== null,
        thumbnails: videoThumbnails,
        pitchYoutubeTitle: pitch?.youtubeTitle ?? null,
      };
    }),
});

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return (
    <video
      src={props.src}
      className="w-full"
      controls
      preload="none"
      ref={ref}
    />
  );
};

export default function PostPageRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    isYoutubeAuthenticated,
    thumbnails,
    videoExists,
    pitchYoutubeTitle,
  } = props.loaderData;

  // Context panel state
  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() => {
    return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
  });
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(() => {
    return new Set(chapters.map((s) => s.id));
  });
  const [includeCourseStructure, setIncludeCourseStructure] = useState(false);

  // File preview modal state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>("");

  // Add link modal state
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  // Delete link fetcher
  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  // File management state
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };

  const handleEditFile = async (filePath: string) => {
    try {
      const response = await fetch(
        `/api/video-files/read?videoId=${videoId}&path=${encodeURIComponent(filePath)}`
      );
      if (response.ok) {
        const content = await response.text();
        setSelectedFilePath(filePath);
        setSelectedFileContent(content);
        setIsFileModalOpen(true);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };

  const handleDeleteFile = (filePath: string) => {
    setFileToDelete(filePath);
    setIsDeleteModalOpen(true);
  };

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          chapters={chapters}
          enabledSections={enabledSections}
          onEnabledSectionsChange={setEnabledSections}
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={setIncludeTranscript}
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          onIncludeCourseStructureChange={setIncludeCourseStructure}
          files={files}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={setEnabledFiles}
          onFileClick={handleFileClick}
          onOpenFolderClick={() => {
            openFolderFetcher.submit(null, {
              method: "post",
              action: `/api/videos/${videoId}/open-folder`,
            });
          }}
          onAddFromClipboardClick={() => setIsPasteModalOpen(true)}
          onEditFile={handleEditFile}
          onDeleteFile={handleDeleteFile}
          links={links}
          onAddLinkClick={() => setIsAddLinkModalOpen(true)}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          videoSlot={
            videoExists ? (
              <Video src={`/api/videos/${videoId}/stream`} />
            ) : (
              <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
                <VideoOffIcon className="size-10 text-muted-foreground" />
                <p className="text-muted-foreground text-sm text-center px-4">
                  Video file not found on disk.
                </p>
              </div>
            )
          }
          onRevealInFileSystem={
            videoExists
              ? () => {
                  revealVideoFetcher.submit(
                    {},
                    {
                      method: "post",
                      action: `/api/videos/${videoId}/reveal`,
                    }
                  );
                }
              : undefined
          }
        />

        {/* Right panel: Tabbed posting interface */}
        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <PostPage
            videoId={videoId}
            isYoutubeAuthenticated={isYoutubeAuthenticated}
            thumbnails={thumbnails}
            enabledFiles={enabledFiles}
            enabledSections={enabledSections}
            includeTranscript={includeTranscript}
            courseStructure={courseStructure}
            includeCourseStructure={includeCourseStructure}
            chapters={chapters}
            pitchYoutubeTitle={pitchYoutubeTitle}
          />
        </div>
      </div>

      {/* File preview modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={videoId}
        filePath={previewFilePath}
      />

      {/* Add link modal */}
      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />

      {/* File modals */}
      <VideoFileManagementModal
        videoId={videoId}
        path={selectedFilePath}
        content={selectedFileContent}
        open={isFileModalOpen}
        onOpenChange={setIsFileModalOpen}
      />
      <VideoFilePasteModal
        videoId={videoId}
        open={isPasteModalOpen}
        onOpenChange={setIsPasteModalOpen}
        existingFiles={files}
        onFileCreated={(path) => {
          setEnabledFiles((prev) => new Set([...prev, path]));
        }}
      />
      <DeleteVideoFileModal
        videoId={videoId}
        path={fileToDelete}
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
      />
    </>
  );
}
