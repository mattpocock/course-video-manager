import { useCallback, useMemo, useState } from "react";
import { toastError } from "@/components/ui/toast";
import {
  removeChooseScreenshot,
  replaceChooseScreenshotWithImage,
  setChooseScreenshotFace,
  updateChooseScreenshotClipIndex,
  type ScreenshotFace,
} from "./choose-screenshot-mutations";
import type { ChooseScreenshotRuntime } from "./choose-screenshot-components";
import type { IndexedClip } from "./types";
import type { ClipFrame, ScreenCrop } from "@/packages/clip-source";
import { screenshotMemory } from "./screenshot-memory";
import { log } from "@/packages/log";

/**
 * The document pane's `<ChooseScreenshot>` runtime: capturing a frame from the
 * video and folding it into the working document, re-pointing a placeholder at
 * another clip, or removing it. Each capture is remembered for this session
 * (`screenshot-memory.ts`), so its image can be revived back into the
 * placeholder it came from. `isCapturing` holds sends back while a capture
 * is in flight (see `use-message-queue.ts`). It all works while the model
 * is still writing: `updateDocument` queues the edit until the turn ends.
 */
export function useDocScreenshotRuntime(opts: {
  videoId: string;
  indexedClips: IndexedClip[];
  documentRef: React.RefObject<string | undefined>;
  updateDocument: (content: string) => void;
}) {
  const { videoId, indexedClips, documentRef, updateDocument } = opts;
  const [docCapturingKey, setDocCapturingKey] = useState<string | null>(null);

  const handleDocCapture = useCallback(
    async (
      clipIndex: number,
      alt: string,
      frame: ClipFrame,
      placeholder: { face: ScreenshotFace; crop: ScreenCrop | null }
    ) => {
      const key = `doc-${clipIndex}-${alt}`;
      setDocCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(frame),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        screenshotMemory.remember(videoId, imagePath, {
          clipIndex,
          alt,
          ...placeholder,
          time: frame.time,
        });
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
        return true;
      } catch (err) {
        log.error("Screenshot capture failed:", err);
        toastError(err, "Screenshot capture failed");
        return false;
      } finally {
        setDocCapturingKey(null);
      }
    },
    [videoId, documentRef, updateDocument]
  );

  const handleDocClipIndexChange = useCallback(
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

  const handleDocRemove = useCallback(
    (clipIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(removeChooseScreenshot(currentDoc, clipIndex, alt));
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocFaceChange = useCallback(
    (
      clipIndex: number,
      alt: string,
      face: ScreenshotFace,
      crop?: ScreenCrop
    ) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          setChooseScreenshotFace(currentDoc, clipIndex, alt, face, crop)
        );
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocRevive = useCallback(
    (imagePath: string) => {
      const currentDoc = documentRef.current;
      const revived =
        currentDoc && screenshotMemory.revive(videoId, currentDoc, imagePath);
      if (revived) updateDocument(revived);
    },
    [videoId, documentRef, updateDocument]
  );

  // The document is a single scope, so the message id plays no part in its keys.
  const docScreenshotRuntime = useMemo(
    (): ChooseScreenshotRuntime => ({
      clips: indexedClips,
      // Live while the model writes: an edit made mid-stream waits in the
      // document flow's pending edits until the turn ends
      // (`document-flow-reducer.ts`). The capture itself, and its PNG,
      // happen at once.
      isStreaming: false,
      capturingKey: docCapturingKey,
      keyFor: (clipIndex, alt) => `doc-${clipIndex}-${alt}`,
      onClipIndexChange: (_messageId, current, next, alt) =>
        handleDocClipIndexChange(current, next, alt),
      // The capture toasts its own failure; Return waits on the result.
      onCapture: (_messageId, clipIndex, alt, frame, placeholder) =>
        handleDocCapture(clipIndex, alt, frame, placeholder),
      onRemove: (_messageId, clipIndex, alt) => handleDocRemove(clipIndex, alt),
      onFaceChange: (_messageId, clipIndex, alt, face, crop) =>
        handleDocFaceChange(clipIndex, alt, face, crop),
      revive: {
        canRevive: (imagePath, alt) =>
          screenshotMemory.canRevive(videoId, imagePath, alt),
        revive: handleDocRevive,
        startTime: (clipIndex, alt) =>
          screenshotMemory.startTime(videoId, clipIndex, alt),
      },
    }),
    [
      indexedClips,
      docCapturingKey,
      handleDocClipIndexChange,
      handleDocCapture,
      handleDocRemove,
      handleDocFaceChange,
      handleDocRevive,
      videoId,
    ]
  );

  return { docScreenshotRuntime, isCapturing: docCapturingKey !== null };
}
