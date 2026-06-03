"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { VideoContextPanel } from "@/components/video-context-panel";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { StandaloneFileManagementModal } from "@/components/standalone-file-management-modal";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { DeleteStandaloneFileModal } from "@/components/delete-standalone-file-modal";
import { DeleteLessonFileModal } from "@/components/delete-lesson-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import { NewsletterPagePanel } from "@/features/video-posting/newsletter-page";
import type { Route } from "./+types/_app.videos.$videoId.newsletter";
import { toast } from "sonner";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const kitSequenceUrl =
        process.env.KIT_SEQUENCE_URL || "https://app.kit.com/sequences/2625552";
      return { ...ctx, kitSequenceUrl };
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

export default function NewsletterPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    kitSequenceUrl,
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

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  // Standalone file management state
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  // Lesson file paste modal state
  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };

  const handleEditFile = async (filename: string) => {
    try {
      const response = await fetch(
        `/api/standalone-files/read?videoId=${videoId}&filename=${encodeURIComponent(filename)}`
      );
      if (response.ok) {
        const content = await response.text();
        setSelectedFilename(filename);
        setSelectedFileContent(content);
        setIsFileModalOpen(true);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };

  const handleDeleteFile = (filename: string) => {
    setFileToDelete(filename);
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
          onAddFromClipboardClick={
            isStandalone
              ? () => setIsPasteModalOpen(true)
              : () => setIsLessonPasteModalOpen(true)
          }
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

        {/* Right panel: Newsletter interface */}
        <NewsletterPagePanel
          videoId={videoId}
          chapters={chapters}
          enabledSections={enabledSections}
          enabledFiles={enabledFiles}
          includeTranscript={includeTranscript}
          includeCourseStructure={includeCourseStructure}
          courseStructure={courseStructure}
          kitSequenceUrl={kitSequenceUrl}
        />
      </div>

      {/* File preview modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        videoId={videoId}
        filePath={previewFilePath}
        isStandalone={isStandalone}
      />

      {/* Add link modal */}
      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />

      {/* Standalone file modals */}
      {isStandalone && (
        <>
          <StandaloneFileManagementModal
            videoId={videoId}
            filename={selectedFilename}
            content={selectedFileContent}
            open={isFileModalOpen}
            onOpenChange={setIsFileModalOpen}
          />
          <StandaloneFilePasteModal
            videoId={videoId}
            open={isPasteModalOpen}
            onOpenChange={setIsPasteModalOpen}
            existingFiles={files}
            onFileCreated={(filename) => {
              setEnabledFiles((prev) => new Set([...prev, filename]));
            }}
          />
          <DeleteStandaloneFileModal
            videoId={videoId}
            filename={fileToDelete}
            open={isDeleteModalOpen}
            onOpenChange={setIsDeleteModalOpen}
          />
        </>
      )}

      {/* Lesson file modals */}
      {!isStandalone && (
        <>
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
      )}
    </>
  );
}
