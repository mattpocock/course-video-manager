"use client";

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import {
  VideoContextPanel,
  type FileMetadata,
  type Link,
  type CourseStructure,
} from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { StandaloneFileManagementModal } from "@/components/standalone-file-management-modal";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { DeleteStandaloneFileModal } from "@/components/delete-standalone-file-modal";
import { DeleteLessonFileModal } from "@/components/delete-lesson-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";

export type VideoPostingContextState = {
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  includeCourseStructure: boolean;
  courseStructure: CourseStructure | null;
  chapters: SectionWithWordCount[];
};

export type VideoPostingLayoutProps = {
  videoId: string;
  files: FileMetadata[];
  isStandalone: boolean;
  transcriptWordCount: number;
  chapters: SectionWithWordCount[];
  links: Link[];
  courseStructure: CourseStructure | null;
  videoSlot?: React.ReactNode;
  onRevealInFileSystem?: () => void;
  children: (contextState: VideoPostingContextState) => React.ReactNode;
};

export function createInitialEnabledFiles(files: FileMetadata[]): Set<string> {
  return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
}

export function createInitialEnabledSections(
  chapters: SectionWithWordCount[]
): Set<string> {
  return new Set(chapters.map((s) => s.id));
}

export function createHandleFileClick(
  setPreviewFilePath: (path: string) => void,
  setIsPreviewModalOpen: (open: boolean) => void
) {
  return (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };
}

export function createHandleDeleteFile(
  setFileToDelete: (filename: string) => void,
  setIsDeleteModalOpen: (open: boolean) => void
) {
  return (filename: string) => {
    setFileToDelete(filename);
    setIsDeleteModalOpen(true);
  };
}

export function createHandleEditFile(
  videoId: string,
  setters: {
    setSelectedFilename: (filename: string) => void;
    setSelectedFileContent: (content: string) => void;
    setIsFileModalOpen: (open: boolean) => void;
  }
) {
  return async (filename: string) => {
    try {
      const response = await fetch(
        `/api/standalone-files/read?videoId=${videoId}&filename=${encodeURIComponent(filename)}`
      );
      if (response.ok) {
        const content = await response.text();
        setters.setSelectedFilename(filename);
        setters.setSelectedFileContent(content);
        setters.setIsFileModalOpen(true);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };
}

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

export function VideoPostingLayout({
  videoId,
  files,
  isStandalone,
  transcriptWordCount,
  chapters,
  links,
  courseStructure,
  videoSlot,
  onRevealInFileSystem,
  children,
}: VideoPostingLayoutProps) {
  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() =>
    createInitialEnabledFiles(files)
  );
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(() =>
    createInitialEnabledSections(chapters)
  );
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
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);

  const handleFileClick = createHandleFileClick(
    setPreviewFilePath,
    setIsPreviewModalOpen
  );

  const handleEditFile = createHandleEditFile(videoId, {
    setSelectedFilename,
    setSelectedFileContent,
    setIsFileModalOpen,
  });

  const handleDeleteFile = createHandleDeleteFile(
    setFileToDelete,
    setIsDeleteModalOpen
  );

  const defaultVideoSlot = <Video src={`/api/videos/${videoId}/stream`} />;

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
          videoSlot={videoSlot ?? defaultVideoSlot}
          onRevealInFileSystem={onRevealInFileSystem}
        />

        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          {children({
            enabledFiles,
            enabledSections,
            includeTranscript,
            includeCourseStructure,
            courseStructure,
            chapters,
          })}
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
