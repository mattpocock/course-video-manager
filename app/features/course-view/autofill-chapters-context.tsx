import { AutofillChaptersModal } from "@/features/video-editor/components/autofill-chapters-modal";
import { createHttpClipService } from "@/services/clip-service";
import { createContext, useCallback, useContext, useState } from "react";
import { useRevalidator } from "react-router";

type OpenInput = { videoId: string; videoLabel: string };

const AutofillChaptersContext = createContext<
  ((input: OpenInput) => void) | null
>(null);

export const useAutofillChaptersAction = (): ((input: OpenInput) => void) => {
  const ctx = useContext(AutofillChaptersContext);
  if (!ctx) {
    throw new Error(
      "useAutofillChaptersAction must be used inside AutofillChaptersProvider"
    );
  }
  return ctx;
};

export const AutofillChaptersProvider = ({
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
    <AutofillChaptersContext.Provider value={handleOpen}>
      {children}
      {open && (
        <AutofillChaptersModal
          open={true}
          videoId={open.videoId}
          videoLabel={open.videoLabel}
          onClose={() => setOpen(null)}
          onConfirm={async (sections) => {
            const clipService = createHttpClipService();
            await clipService.autofillChapters({
              videoId: open.videoId,
              sections,
            });
            revalidator.revalidate();
            setOpen(null);
          }}
        />
      )}
    </AutofillChaptersContext.Provider>
  );
};
