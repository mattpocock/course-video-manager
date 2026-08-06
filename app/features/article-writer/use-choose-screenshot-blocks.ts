import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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

  /**
   * "Find all", pressed mid-stream, waits for the stream rather than refusing.
   *
   * The tags Matt can already see are real, but the prose around them is not
   * finished, and the search reads that prose as its brief — so firing now
   * would search against text that is about to change. Holding the press means
   * he can arm it and walk away instead of watching for the stream to land.
   *
   * Pressing again while armed cancels: the only way out otherwise would be to
   * let a search he no longer wants run to completion.
   */
  const [isQueued, setIsQueued] = useState(false);

  // Read through a ref so the drain below depends on the stream ending alone.
  // `pending` changes on every token, and a queued run wants the list as it is
  // when the stream lands, not as it was when the button was pressed.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const findAll = useCallback(() => {
    if (isGenerating) {
      setIsQueued((armed) => !armed);
      return;
    }
    void findAllScreenshots(pending);
  }, [isGenerating, findAllScreenshots, pending]);

  useEffect(() => {
    if (isGenerating || !isQueued) return;
    setIsQueued(false);
    void findAllScreenshots(pendingRef.current);
  }, [isGenerating, isQueued, findAllScreenshots]);

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
     * Counts the tags that have fully arrived, including mid-stream — a half
     * written tag does not match, so the number climbs as the model writes.
     */
    pendingCount: pending.length,
    searchingCount,
    /** True once "Find all" has been armed to run when the stream lands. */
    isFindAllQueued: isQueued,
    findAll,
  };
}
