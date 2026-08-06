import { CopyVideoModal } from "@/components/copy-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Suspense, type ReactNode } from "react";
import { useRevalidator } from "react-router";
import { useContextSelector } from "use-context-selector";
import type { ChapterNamingModal } from "../types";
import { VideoEditorContext } from "../video-editor-context";
import { ChapterNamingModal as ChapterNamingModalComponent } from "./chapter-naming-modal";
import { CreateVideoFromSelectionModal } from "./create-video-from-selection-modal";
import { FilePasteModalWithFsData } from "./file-paste-modal-with-fs-data";

/**
 * Every dialog the editor keeps mounted alongside its panels. They live in one
 * place — and out of {@link VideoEditor} — because the surfaces that *open*
 * them (the action menus, the timeline, the Stream Deck) are scattered, so the
 * open flags are all editor-level state either way.
 *
 * The video, its file data, and the open flags the action menus already toggle
 * are read from {@link VideoEditorContext} rather than drilled through props —
 * the same way the panels alongside these dialogs read them.
 */
export const EditorModals = (props: {
  chapterNamingModal: ChapterNamingModal;
  onCloseChapterNamingModal: () => void;
  isPasteModalOpen: boolean;
  setIsPasteModalOpen: (open: boolean) => void;
  /** Clips a copy of this video would duplicate. */
  clipCount: number;
  beatCount: number;
  hasScript: boolean;
  onCreateVideoFromSelection: (title: string, mode: "copy" | "move") => void;
  /** The AI Chapter-generation modal, owned by useAutofillChaptersModal. */
  autofillChaptersModal: ReactNode;
}) => {
  const revalidator = useRevalidator();

  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const fsData = useContextSelector(VideoEditorContext, (ctx) => ctx.fsData);
  const onAddChapter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapter
  );
  const onUpdateChapter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUpdateChapter
  );
  const onAddChapterAt = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapterAt
  );
  const isRenameVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isRenameVideoModalOpen
  );
  const setIsRenameVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsRenameVideoModalOpen
  );
  const isCopyVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isCopyVideoModalOpen
  );
  const setIsCopyVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsCopyVideoModalOpen
  );
  const isCreateVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isCreateVideoModalOpen
  );
  const setIsCreateVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsCreateVideoModalOpen
  );

  return (
    <>
      <ChapterNamingModalComponent
        modalState={props.chapterNamingModal}
        onClose={props.onCloseChapterNamingModal}
        onAddChapter={onAddChapter}
        onUpdateChapter={onUpdateChapter}
        onAddChapterAt={onAddChapterAt}
      />
      <Suspense>
        <FilePasteModalWithFsData
          fsData={fsData}
          videoId={videoId}
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
        videoId={videoId}
        currentName={videoTitle}
        open={isRenameVideoModalOpen}
        onOpenChange={setIsRenameVideoModalOpen}
      />
      <CopyVideoModal
        videoId={videoId}
        videoTitle={videoTitle}
        clipCount={props.clipCount}
        beatCount={props.beatCount}
        hasScript={props.hasScript}
        open={isCopyVideoModalOpen}
        onOpenChange={setIsCopyVideoModalOpen}
        // Open the copy — the editor is a single-video surface, and with
        // "Rename old video" ticked the video still on screen is now the
        // "(old)" one. Mirrors "Create Video from Selection".
        redirectTo="/videos/{id}/edit"
      />
      <CreateVideoFromSelectionModal
        open={isCreateVideoModalOpen}
        onOpenChange={setIsCreateVideoModalOpen}
        onSubmit={props.onCreateVideoFromSelection}
      />
      {props.autofillChaptersModal}
    </>
  );
};
