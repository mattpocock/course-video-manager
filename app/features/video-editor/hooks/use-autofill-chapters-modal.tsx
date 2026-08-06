import { useCallback, useState, type ReactNode } from "react";
import {
  AutofillChaptersModal,
  type ClipForPreview,
} from "../components/autofill-chapters-modal";
import type { Clip } from "../clip-state-reducer";
import type { ReferenceCandidate } from "../components/reference-panel";

type ModalState = {
  videoId: string;
  label: string;
  clips: ClipForPreview[];
} | null;

export const useAutofillChaptersModal = (input: {
  mainVideoId: string;
  mainVideoTitle: string;
  clips: Clip[];
  referenceCandidates: ReferenceCandidate[];
  onAutofillChapters: (
    videoId: string,
    sections: Array<{ beforeClipId: string; title: string }>
  ) => Promise<void>;
}): {
  openForMain: () => void;
  openForReference: (refVideoId: string) => void;
  modal: ReactNode;
} => {
  const [state, setState] = useState<ModalState>(null);

  const openForMain = useCallback(() => {
    const mainClips: ClipForPreview[] = input.clips
      .filter(
        (c): c is Extract<Clip, { type: "on-database" }> =>
          c.type === "on-database"
      )
      .map((c) => ({
        id: c.databaseId as string,
        text: c.text ?? "",
      }));
    setState({
      videoId: input.mainVideoId,
      label: input.mainVideoTitle,
      clips: mainClips,
    });
  }, [input.clips, input.mainVideoId, input.mainVideoTitle]);

  const openForReference = useCallback(
    (refVideoId: string) => {
      const candidate = input.referenceCandidates.find(
        (c) => c.id === refVideoId
      );
      if (!candidate) return;
      setState({
        videoId: candidate.id,
        label: candidate.title,
        clips: candidate.clips.map((c) => ({ id: c.id, text: c.text })),
      });
    },
    [input.referenceCandidates]
  );

  const modal = state ? (
    <AutofillChaptersModal
      open={true}
      videoId={state.videoId}
      videoLabel={state.label}
      clips={state.clips}
      onClose={() => setState(null)}
      onConfirm={async (sections) => {
        await input.onAutofillChapters(state.videoId, sections);
        setState(null);
      }}
    />
  ) : null;

  return { openForMain, openForReference, modal };
};
