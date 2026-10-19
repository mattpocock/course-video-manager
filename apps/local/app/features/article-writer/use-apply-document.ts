"use client";

import { useCallback, type RefObject } from "react";
import { toast } from "@/components/ui/toast";
import { useImageUploadJob } from "@/features/image-upload/use-image-upload-job";
import { hasUnresolvedScreenshots } from "./choose-screenshot-mutations";

/**
 * Apply: the document's local images go to Cloudinary as an `upload-images`
 * Job, then the URLs are swapped into the document as it is when the Job
 * settles — edits made while it ran survive — and the result is saved
 * through `onApply`. Local files are removed only once that save is
 * confirmed, and `onApplied` runs then. `finalize` shapes the document that
 * is saved (a Solution loses its quizzes) and the writer shows that result.
 */
export function useApplyDocument(
  videoId: string,
  documentRef: RefObject<string | undefined>,
  updateDocument: (content: string) => void,
  onApply: (finalDocument: string) => Promise<void>,
  onApplied?: (finalDocument: string) => void,
  finalize: (document: string) => string = (document) => document
) {
  const { isUploading, upload } = useImageUploadJob(videoId, {
    read: () => finalize(documentRef.current ?? ""),
    save: (finalDocument) => {
      updateDocument(finalDocument);
      return onApply(finalDocument);
    },
    onSaved: (finalDocument) => onApplied?.(finalDocument),
  });

  const handleApply = useCallback(() => {
    const doc = documentRef.current ?? "";
    if (hasUnresolvedScreenshots(doc)) {
      toast.error("Resolve all screenshot placeholders before applying");
      return;
    }
    upload(true);
  }, [documentRef, upload]);

  return { isApplying: isUploading, handleApply };
}
