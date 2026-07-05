"use client";

export const handle = { fullscreen: true };

import {
  loadVideoPostingContext,
  loadWriterContext,
} from "@/services/video-posting-context.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { WriterContextData } from "@/services/video-posting-context.server";
import { VideoContextPanel } from "@/components/video-context-panel";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { DeleteLessonFileModal } from "@/components/delete-lesson-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import { toast } from "sonner";
import type { Route } from "./+types/_app.videos.$videoId.lesson";
import { LessonPage } from "@/features/video-posting/lesson-page";
import { useWriterContext } from "@/features/article-writer/use-writer-context";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);
      const ctx = yield* loadVideoPostingContext(videoId);
      const writerContextPromise: Promise<WriterContextData> =
        runtimeLive.runPromise(loadWriterContext(videoId));
      return {
        ...ctx,
        videoBody: video.body,
        videoDescription: video.description,
        writerContextPromise,
      };
    }),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const data = payload as Record<string, string>;

      if (data.intent === "updateBody") {
        yield* videoOps.updateVideoBody({
          videoId,
          body: data.body || null,
        });
        return { ok: true };
      }

      if (data.intent === "updateDescription") {
        yield* videoOps.updateVideoDescription({
          videoId,
          description: data.description || null,
        });
        return { ok: true };
      }

      return { ok: false };
    }),
});

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

export default function LessonPostPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    videoBody,
    videoDescription,
    writerContextPromise,
  } = props.loaderData;

  const writerContext = useWriterContext(writerContextPromise);

  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() => {
    return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
  });
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(() => {
    return new Set(chapters.map((s) => s.id));
  });
  const [includeCourseStructure, setIncludeCourseStructure] = useState(false);

  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>("");
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
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
          isStandalone={isStandalone}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={setEnabledFiles}
          onFileClick={handleFileClick}
          onOpenFolderClick={() => {
            openFolderFetcher.submit(null, {
              method: "post",
              action: `/api/videos/${videoId}/open-folder`,
            });
          }}
          onAddFromClipboardClick={() => setIsLessonPasteModalOpen(true)}
          onDeleteFile={(filename) => {
            setFileToDelete(filename);
            setIsDeleteModalOpen(true);
          }}
          links={links}
          onAddLinkClick={() => setIsAddLinkModalOpen(true)}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          videoSlot={<Video src={`/api/videos/${videoId}/stream`} />}
        />

        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <LessonPage
            videoId={videoId}
            body={videoBody}
            description={videoDescription}
            writerContext={writerContext}
          />
        </div>
      </div>

      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={videoId}
        filePath={previewFilePath}
        isStandalone={isStandalone}
      />

      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />

      <LessonFilePasteModal
        videoId={videoId}
        open={isLessonPasteModalOpen}
        onOpenChange={setIsLessonPasteModalOpen}
        existingFiles={files}
        onFileCreated={(filename) => {
          setEnabledFiles((prev) => new Set([...prev, filename]));
        }}
      />
      <DeleteLessonFileModal
        videoId={videoId}
        filename={fileToDelete}
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
      />
    </>
  );
}
