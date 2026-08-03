import { useCallback, useState, type RefObject } from "react";
import { replaceChooseScreenshotWithImage } from "./choose-screenshot-mutations";
import { extractSurroundingText } from "./screenshot-surrounding-text";
import type { IndexedClip, ScreenshotProposal } from "./types";

/** The state key a ChooseScreenshot block is identified by. */
const proposalKey = (clipIndex: number, alt: string) =>
  `doc-${clipIndex}-${alt}`;

export interface UseScreenshotProposalsProps {
  videoId: string;
  indexedClips: IndexedClip[];
  documentRef: RefObject<string | undefined>;
  updateDocument: (next: string) => void;
  /** The same retarget used by the block's Prev/Next buttons. */
  onClipIndexChange: (
    currentIndex: number,
    newIndex: number,
    alt: string
  ) => void;
}

/**
 * Screenshot proposals for the document's ChooseScreenshot blocks.
 *
 * Proposals are held here and never written into the document: the tag is only
 * replaced by an image on Apply, so a rejected proposal leaves no trace and a
 * wrong one costs a glance. They are also deliberately not persisted — the
 * captured frame survives on disk regardless, so a reload just means asking
 * again.
 */
export function useScreenshotProposals({
  videoId,
  indexedClips,
  documentRef,
  updateDocument,
  onClipIndexChange,
}: UseScreenshotProposalsProps) {
  const [proposals, setProposals] = useState<
    Record<string, ScreenshotProposal>
  >({});
  const [proposingKey, setProposingKey] = useState<string | null>(null);

  const findScreenshot = useCallback(
    async (clipIndex: number, alt: string) => {
      const key = proposalKey(clipIndex, alt);
      setProposingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/propose-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alt,
            clipIndex,
            clips: indexedClips,
            surroundingText: extractSurroundingText(
              documentRef.current ?? "",
              clipIndex,
              alt
            ),
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to propose screenshot");
        }
        const proposal: ScreenshotProposal = await res.json();

        // A winning frame in a neighbouring clip means the writer's clipIndex
        // was off. Retarget the tag through the same mutation Prev/Next uses,
        // then file the proposal under the key the re-rendered block will read.
        if (proposal.found && proposal.clipIndex !== clipIndex) {
          onClipIndexChange(clipIndex, proposal.clipIndex, alt);
          setProposals((prev) => ({
            ...prev,
            [proposalKey(proposal.clipIndex, alt)]: proposal,
          }));
          return;
        }
        setProposals((prev) => ({ ...prev, [key]: proposal }));
      } catch (err) {
        console.error("Screenshot proposal failed:", err);
        setProposals((prev) => ({
          ...prev,
          [key]: {
            found: false,
            reason: err instanceof Error ? err.message : "Unknown error",
          },
        }));
      } finally {
        setProposingKey(null);
      }
    },
    [videoId, indexedClips, documentRef, onClipIndexChange]
  );

  /** Accept a proposal as-is, reusing the frame captured for the preview. */
  const applyProposal = useCallback(
    (clipIndex: number, alt: string, imagePath: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          replaceChooseScreenshotWithImage(
            currentDoc,
            clipIndex,
            alt,
            imagePath
          )
        );
      }
    },
    [documentRef, updateDocument]
  );

  const dismissProposal = useCallback((clipIndex: number, alt: string) => {
    setProposals((prev) => {
      const next = { ...prev };
      delete next[proposalKey(clipIndex, alt)];
      return next;
    });
  }, []);

  const proposalFor = useCallback(
    (clipIndex: number, alt: string) => proposals[proposalKey(clipIndex, alt)],
    [proposals]
  );

  const isProposingFor = useCallback(
    (clipIndex: number, alt: string) =>
      proposingKey === proposalKey(clipIndex, alt),
    [proposingKey]
  );

  return {
    findScreenshot,
    applyProposal,
    dismissProposal,
    proposalFor,
    isProposingFor,
  };
}
