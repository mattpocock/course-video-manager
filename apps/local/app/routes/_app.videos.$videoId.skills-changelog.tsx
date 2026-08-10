"use client";

export const handle = { fullscreen: true };

import {
  loadVideoPostingContext,
  loadWriterContext,
} from "@/services/video-posting-context.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { WriterContextData } from "@/services/video-posting-context.server";
import { VideoContextPanel } from "@/components/video-context-panel";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { VideoFileManagementModal } from "@/components/video-file-management-modal";
import { VideoFilePasteModal } from "@/components/video-file-paste-modal";
import { DeleteVideoFileModal } from "@/components/delete-video-file-modal";
import { toast } from "sonner";
import type { Route } from "./+types/_app.videos.$videoId.skills-changelog";
import { SkillsChangelogPage } from "@/features/video-posting/skills-changelog-page";
import { useWriterContext } from "@/features/article-writer/use-writer-context";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const aiHeroAuth = yield* linkAuthOps.getAiHeroAuth();
      const aiHero: { connected: true; userId: string } | { connected: false } =
        aiHeroAuth
          ? { connected: true, userId: aiHeroAuth.userId }
          : { connected: false };
      const writerContextPromise: Promise<WriterContextData> =
        runtimeLive.runPromise(loadWriterContext(params.videoId!));
      return { ...ctx, aiHero, writerContextPromise };
    }),
});

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

export default function SkillsChangelogRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    aiHero,
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
          videoSlot={<Video src={`/api/videos/${videoId}/stream`} />}
        />

        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <SkillsChangelogPage
            videoId={videoId}
            aiHero={aiHero}
            enabledFiles={enabledFiles}
            enabledSections={enabledSections}
            includeTranscript={includeTranscript}
            courseStructure={courseStructure}
            includeCourseStructure={includeCourseStructure}
            chapters={chapters}
            writerContext={writerContext}
          />
        </div>
      </div>

      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={videoId}
        filePath={previewFilePath}
      />

      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />

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
