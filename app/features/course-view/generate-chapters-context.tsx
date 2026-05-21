import { GenerateChaptersModal } from "@/features/video-editor/components/generate-chapters-modal";
import { createHttpClipService } from "@/services/clip-service";
import { createContext, useCallback, useContext, useState } from "react";
import { useRevalidator } from "react-router";

type OpenInput = { videoId: string; videoLabel: string };

const GenerateChaptersContext = createContext<
  ((input: OpenInput) => void) | null
>(null);

export const useGenerateChaptersAction = (): ((input: OpenInput) => void) => {
  const ctx = useContext(GenerateChaptersContext);
  if (!ctx) {
    throw new Error(
      "useGenerateChaptersAction must be used inside GenerateChaptersProvider"
    );
  }
  return ctx;
};

export const GenerateChaptersProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const revalidator = useRevalidator();
  const [open, setOpen] = useState<OpenInput | null>(null);

  const handleOpen = useCallback((input: OpenInput) => {
    setOpen(input);
  }, []);

  return (
    <GenerateChaptersContext.Provider value={handleOpen}>
      {children}
      {open && (
        <GenerateChaptersModal
          open={true}
          videoId={open.videoId}
          videoLabel={open.videoLabel}
          onClose={() => setOpen(null)}
          onConfirm={async (sections) => {
            const clipService = createHttpClipService();
            await clipService.regenerateChapters({
              videoId: open.videoId,
              sections,
            });
            revalidator.revalidate();
            setOpen(null);
          }}
        />
      )}
    </GenerateChaptersContext.Provider>
  );
};
