"use client";

import { useCallback, useState, type RefObject } from "react";
import { toast } from "sonner";

export function useApplyDocument(
  videoId: string,
  documentRef: RefObject<string | undefined>,
  updateDocument: (content: string) => void,
  onApply?: (finalDocument: string) => void
) {
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = useCallback(async () => {
    const doc = documentRef.current ?? "";
    let finalDoc = doc;
    if (doc.trim()) {
      setIsApplying(true);
      try {
        const res = await fetch(`/api/videos/${videoId}/upload-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: doc, deleteLocalFiles: true }),
        });
        if (!res.ok) {
          throw new Error((await res.text()) || "Failed to upload images");
        }
        const { body: uploaded } = await res.json();
        if (uploaded) {
          finalDoc = uploaded;
          if (uploaded !== doc) updateDocument(uploaded);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to upload images"
        );
      } finally {
        setIsApplying(false);
      }
    }
    onApply?.(finalDoc);
  }, [videoId, documentRef, updateDocument, onApply]);

  return { isApplying, handleApply };
}
