import { use } from "react";
import { VideoFilePasteModal } from "@/components/video-file-paste-modal";

type FsData = {
  hasExplainerFolder: boolean;
  standaloneFiles: Array<{ path: string }>;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
};

export const FilePasteModalWithFsData = (props: {
  fsData: Promise<FsData>;
  videoId: string;
  isPasteModalOpen: boolean;
  handlePasteModalClose: (open: boolean) => void;
  handleFileCreated: () => void;
}) => {
  const fsData = use(props.fsData);
  return (
    <VideoFilePasteModal
      videoId={props.videoId}
      open={props.isPasteModalOpen}
      onOpenChange={props.handlePasteModalClose}
      existingFiles={fsData.files}
      onFileCreated={props.handleFileCreated}
    />
  );
};
