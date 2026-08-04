import { useCallback, useMemo, useState, type RefObject } from "react";
import type { Options } from "react-markdown";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import {
  CHOOSE_SCREENSHOT_COMPONENTS,
  chooseScreenshotKey,
  type ChooseScreenshotHost,
} from "./choose-screenshot-md";
import {
  listChooseScreenshotTags,
  removeChooseScreenshot,
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
} from "./choose-screenshot-mutations";
import { useScreenshotProposals } from "./use-screenshot-proposals";
import type { IndexedClip } from "./types";

export interface UseChooseScreenshotBlocksProps {
  videoId: string;
  indexedClips: IndexedClip[];
  isDocumentMode: boolean;
  /** True while the model is writing, which parks the blocks and the toolbar. */
  isGenerating: boolean;
  document: string | undefined;
  documentRef: RefObject<string | undefined>;
  updateDocument: (content: string) => void;
}

/**
 * Everything the document preview's ChooseScreenshot blocks need.
 *
 * Gathers the three document rewrites a block can perform — capture, retarget,
 * remove — with the candidate search that feeds it, because they are only
 * separable on paper: the search exists to fill in a capture, and both are
 * addressed by the same `clipIndex`/`alt` pair.
 */
export function useChooseScreenshotBlocks({
  videoId,
  indexedClips,
  isDocumentMode,
  isGenerating,
  document,
  documentRef,
  updateDocument,
}: UseChooseScreenshotBlocksProps) {
  const [capturingKey, setCapturingKey] = useState<string | null>(null);

  const {
    findScreenshot,
    findAllScreenshots,
    dismissProposal,
    proposalFor,
    isProposingFor,
    selectionFor,
    selectCandidate,
    searchingCount,
  } = useScreenshotProposals({ videoId, indexedClips, documentRef });

  const handleCapture = useCallback(
    async (
      clipIndex: number,
      alt: string,
      timestamp: number,
      videoFilename: string
    ) => {
      setCapturingKey(chooseScreenshotKey(clipIndex, alt));
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestamp, videoFilename }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
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
      } catch (err) {
        console.error("Screenshot capture failed:", err);
      } finally {
        setCapturingKey(null);
      }
    },
    [videoId, documentRef, updateDocument]
  );

  const handleClipIndexChange = useCallback(
    (currentIndex: number, newIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          updateChooseScreenshotClipIndex(
            currentDoc,
            currentIndex,
            newIndex,
            alt
          )
        );
      }
    },
    [documentRef, updateDocument]
  );

  const handleRemove = useCallback(
    (clipIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(removeChooseScreenshot(currentDoc, clipIndex, alt));
      }
    },
    [documentRef, updateDocument]
  );

  /**
   * The blocks "Find all" would search: every tag that has not been answered.
   *
   * A declined block counts as answered — re-asking would spend another two
   * vision calls to be told the same thing. Rejecting a block puts it back.
   */
  const pending = useMemo(
    () =>
      listChooseScreenshotTags(document ?? "").filter(
        (tag) => !proposalFor(tag.clipIndex, tag.alt)
      ),
    [document, proposalFor]
  );

  const findAll = useCallback(
    () => void findAllScreenshots(pending),
    [findAllScreenshots, pending]
  );

  // Deliberately not a `useMemo` over the writer's state: the map is a module
  // constant, and everything volatile reaches the blocks through the context.
  // See `choose-screenshot-md.tsx` for why identity is load-bearing.
  const extraComponents: Options["components"] | undefined =
    indexedClips.length === 0 || !isDocumentMode
      ? undefined
      : CHOOSE_SCREENSHOT_COMPONENTS;

  const host = useMemo(
    (): ChooseScreenshotHost => ({
      clips: indexedClips,
      onClipIndexChange: handleClipIndexChange,
      onCapture: handleCapture,
      onRemove: handleRemove,
      capturingKey,
      isStreaming: isGenerating,
      onFindScreenshot: findScreenshot,
      onDismissProposal: dismissProposal,
      proposalFor,
      isProposingFor,
      selectionFor,
      onSelectCandidate: selectCandidate,
    }),
    [
      indexedClips,
      handleClipIndexChange,
      handleCapture,
      handleRemove,
      capturingKey,
      isGenerating,
      findScreenshot,
      dismissProposal,
      proposalFor,
      isProposingFor,
      selectionFor,
      selectCandidate,
    ]
  );

  return {
    host,
    extraComponents,
    preprocessMarkdown: extraComponents
      ? preprocessChooseScreenshotMarkdown
      : undefined,
    /** Non-null while a capture is writing back to the document. */
    capturingKey,
    /**
     * Hidden while the model is writing, matching the blocks themselves: the
     * tags are still arriving, and a search fired now would be against prose
     * that is about to change.
     */
    pendingCount: isGenerating ? 0 : pending.length,
    searchingCount,
    findAll,
  };
}
