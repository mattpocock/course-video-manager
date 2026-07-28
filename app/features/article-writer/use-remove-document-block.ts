import { useCallback, type MutableRefObject } from "react";
import type { RemoveBlockHandler } from "components/ui/kibo-ui/ai/response";
import { mapPreprocessedOffsetToSource } from "./choose-screenshot-markdown";
import { removeMarkdownBlock } from "./remove-markdown-block";

/**
 * Builds the document preview's per-block remove handler — the X button that
 * appears when hovering a paragraph, heading or list item.
 *
 * Returns `undefined` while the model is writing, which hides the buttons: the
 * document is streaming in from the tool call, so an edit made mid-stream
 * would be overwritten by the next chunk.
 */
export function useRemoveDocumentBlock({
  documentRef,
  updateDocument,
  isGenerating,
  hasScreenshotPreprocessing,
}: {
  documentRef: MutableRefObject<string | undefined>;
  updateDocument: (content: string) => void;
  isGenerating: boolean;
  /**
   * Whether the preview parsed `preprocessChooseScreenshotMarkdown(document)`
   * rather than the document itself — if so the reported offsets need mapping
   * back before they can index into the stored document.
   */
  hasScreenshotPreprocessing: boolean;
}): RemoveBlockHandler | undefined {
  const removeBlock = useCallback<RemoveBlockHandler>(
    ({ start, end }) => {
      const currentDoc = documentRef.current;
      if (!currentDoc) return;
      const toSource = (offset: number) =>
        hasScreenshotPreprocessing
          ? mapPreprocessedOffsetToSource(currentDoc, offset)
          : offset;
      updateDocument(
        removeMarkdownBlock(currentDoc, toSource(start), toSource(end))
      );
    },
    [documentRef, updateDocument, hasScreenshotPreprocessing]
  );

  return isGenerating ? undefined : removeBlock;
}
