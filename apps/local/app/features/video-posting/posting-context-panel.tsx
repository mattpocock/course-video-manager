"use client";

import { useMemo } from "react";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { VideoFileManagementModal } from "@/components/video-file-management-modal";
import { VideoFilePasteModal } from "@/components/video-file-paste-modal";
import { DeleteVideoFileModal } from "@/components/delete-video-file-modal";
import type {
  FileMetadata,
  VideoContextPanelProps,
} from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { useContextPanelReducer } from "@/features/article-writer/use-context-panel-reducer";

/**
 * The context panel the five posting routes share: `contextPanelReducer` for
 * what is picked and which file or link dialog is open, the panel props that
 * dispatch into it, and the dialogs themselves.
 */
export function usePostingContextPanel(props: {
  videoId: string;
  files: FileMetadata[];
  chapters: SectionWithWordCount[];
}) {
  const { videoId, files } = props;
  const { state, dispatch, onModalOpenChange } = useContextPanelReducer(() => ({
    files: props.files,
    chapters: props.chapters,
  }));

  const panelProps = useMemo(
    () =>
      ({
        enabledSections: state.enabledSections,
        onEnabledSectionsChange: (sectionIds) =>
          dispatch({ type: "sections-picked", sectionIds }),
        includeTranscript: state.includeTranscript,
        onIncludeTranscriptChange: (checked) =>
          dispatch({ type: "transcript-checkbox-changed", checked }),
        includeCourseStructure: state.includeCourseStructure,
        onIncludeCourseStructureChange: (checked) =>
          dispatch({ type: "course-structure-checkbox-changed", checked }),
        enabledFiles: state.enabledFiles,
        onEnabledFilesChange: (paths) =>
          dispatch({ type: "files-picked", paths }),
        onFileClick: (path) => dispatch({ type: "file-clicked", path }),
        onAddFromClipboardClick: () =>
          dispatch({ type: "add-from-clipboard-clicked" }),
        onEditFile: (path) =>
          dispatch({ type: "edit-file-clicked", videoId, path }),
        onDeleteFile: (path) => dispatch({ type: "delete-file-clicked", path }),
        onAddLinkClick: () => dispatch({ type: "add-link-clicked" }),
      }) satisfies Partial<VideoContextPanelProps>,
    [
      state.enabledSections,
      state.includeTranscript,
      state.includeCourseStructure,
      state.enabledFiles,
      dispatch,
      videoId,
    ]
  );

  const modals = (
    <>
      <FilePreviewModal
        isOpen={state.openModal === "preview-file"}
        onClose={() => onModalOpenChange["preview-file"](false)}
        videoId={videoId}
        filePath={state.previewFilePath}
      />
      <AddLinkModal
        open={state.openModal === "add-link"}
        onOpenChange={onModalOpenChange["add-link"]}
      />
      <VideoFileManagementModal
        videoId={videoId}
        path={state.editingFile.path}
        content={state.editingFile.content}
        open={state.openModal === "edit-file"}
        onOpenChange={onModalOpenChange["edit-file"]}
      />
      <VideoFilePasteModal
        videoId={videoId}
        open={state.openModal === "paste-file"}
        onOpenChange={onModalOpenChange["paste-file"]}
        existingFiles={files}
        onFileCreated={(path) => dispatch({ type: "file-pasted", path })}
      />
      <DeleteVideoFileModal
        videoId={videoId}
        path={state.fileToDelete}
        open={state.openModal === "delete-file"}
        onOpenChange={onModalOpenChange["delete-file"]}
      />
    </>
  );

  return { state, panelProps, modals };
}
