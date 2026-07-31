import { CopyVideoModal } from "@/components/copy-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Suspense, type ReactNode } from "react";
import { useNavigate, useRevalidator } from "react-router";
import type { FrontendId } from "../clip-state-reducer";
import type { ChapterNamingModal } from "../types";
import { ChapterNamingModal as ChapterNamingModalComponent } from "./chapter-naming-modal";
import { CreateVideoFromSelectionModal } from "./create-video-from-selection-modal";
import { FilePasteModalWithFsData } from "./file-paste-modal-with-fs-data";

/**
 * Every dialog the editor keeps mounted alongside its panels. They live in one
 * place — and out of {@link VideoEditor} — because the surfaces that *open*
 * them (the action menus, the timeline, the Stream Deck) are scattered, so the
 * open flags are all editor-level state either way.
 */
export const EditorModals = (props: {
  videoId: string;
  videoTitle: string;
  fsData: Promise<{
    hasExplainerFolder: boolean;
    standaloneFiles: Array<{ path: string }>;
    files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  }>;
  chapterNamingModal: ChapterNamingModal;
  onCloseChapterNamingModal: () => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onAddChapterAt: (
    name: string,
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
  isPasteModalOpen: boolean;
  setIsPasteModalOpen: (open: boolean) => void;
  isRenameVideoModalOpen: boolean;
  setIsRenameVideoModalOpen: (open: boolean) => void;
  isCopyVideoModalOpen: boolean;
  setIsCopyVideoModalOpen: (open: boolean) => void;
  /** Clips a copy of this video would duplicate. */
  copyableClipCount: number;
  beatCount: number;
  hasScript: boolean;
  isCreateVideoModalOpen: boolean;
  setIsCreateVideoModalOpen: (open: boolean) => void;
  onCreateVideoFromSelection: (title: string, mode: "copy" | "move") => void;
  /** The AI Chapter-generation modal, owned by useGenerateChaptersModal. */
  generateChaptersModal: ReactNode;
}) => {
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return (
    <>
      <ChapterNamingModalComponent
        modalState={props.chapterNamingModal}
        onClose={props.onCloseChapterNamingModal}
        onAddChapter={props.onAddChapter}
        onUpdateChapter={props.onUpdateChapter}
        onAddChapterAt={props.onAddChapterAt}
      />
      <Suspense>
        <FilePasteModalWithFsData
          fsData={props.fsData}
          videoId={props.videoId}
          isPasteModalOpen={props.isPasteModalOpen}
          handlePasteModalClose={(open) => {
            props.setIsPasteModalOpen(open);
            // Revalidate to refresh the file list
            if (!open) revalidator.revalidate();
          }}
          handleFileCreated={() => {}}
        />
      </Suspense>
      <RenameVideoModal
        videoId={props.videoId}
        currentName={props.videoTitle}
        open={props.isRenameVideoModalOpen}
        onOpenChange={props.setIsRenameVideoModalOpen}
      />
      <CopyVideoModal
        videoId={props.videoId}
        videoTitle={props.videoTitle}
        clipCount={props.copyableClipCount}
        beatCount={props.beatCount}
        hasScript={props.hasScript}
        open={props.isCopyVideoModalOpen}
        onOpenChange={props.setIsCopyVideoModalOpen}
        onCopied={(newVideoId) => {
          // Open the copy — the editor is a single-video surface, and with
          // "Rename old video" ticked the video still on screen is now the
          // "(old)" one. Mirrors "Create Video from Selection".
          navigate(`/videos/${newVideoId}/edit`);
        }}
      />
      <CreateVideoFromSelectionModal
        open={props.isCreateVideoModalOpen}
        onOpenChange={props.setIsCreateVideoModalOpen}
        onSubmit={props.onCreateVideoFromSelection}
      />
      {props.generateChaptersModal}
    </>
  );
};
