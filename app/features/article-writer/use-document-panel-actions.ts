import { useCallback, useState, type MutableRefObject } from "react";
import { marked } from "marked";
import { toast } from "sonner";

export function useDocumentPanelActions({
  videoId,
  documentRef,
  updateDocument,
  lessonId,
  setIsCopied,
  revalidate,
}: {
  videoId: string;
  documentRef: MutableRefObject<string | undefined>;
  updateDocument: (content: string) => void;
  lessonId: string | null;
  setIsCopied: (v: boolean) => void;
  revalidate: () => void;
}) {
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingForCopy, setIsUploadingForCopy] = useState(false);
  const [isWritingToReadme, setIsWritingToReadme] = useState(false);

  const uploadAndReplaceImages = useCallback(
    async (content: string, deleteLocalFiles = false): Promise<string> => {
      const response = await fetch(`/api/videos/${videoId}/upload-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: content, deleteLocalFiles }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to upload images");
      }
      const result = await response.json();
      return result.body;
    },
    [videoId]
  );

  const handleUploadImages = useCallback(async () => {
    const currentDoc = documentRef.current;
    if (!currentDoc?.trim()) return;
    setIsUploadingImages(true);
    try {
      const updatedBody = await uploadAndReplaceImages(currentDoc);
      if (updatedBody !== currentDoc) {
        updateDocument(updatedBody);
        toast.success("Images uploaded to Cloudinary");
      } else {
        toast("No local images found to upload");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload images"
      );
    } finally {
      setIsUploadingImages(false);
    }
  }, [documentRef, uploadAndReplaceImages, updateDocument]);

  // Copy handlers upload images to Cloudinary first, then copy
  const handleCopyAsMarkdown = useCallback(async () => {
    const currentDoc = documentRef.current;
    if (!currentDoc) return;
    setIsUploadingForCopy(true);
    try {
      let contentToCopy = currentDoc;
      try {
        const updatedDoc = await uploadAndReplaceImages(currentDoc, true);
        if (updatedDoc !== currentDoc) {
          updateDocument(updatedDoc);
          contentToCopy = updatedDoc;
        }
      } catch {
        // Cloudinary upload failed — copy original content
      }
      await navigator.clipboard.writeText(contentToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    } finally {
      setIsUploadingForCopy(false);
    }
  }, [documentRef, setIsCopied, uploadAndReplaceImages, updateDocument]);

  const handleCopyAsRichText = useCallback(async () => {
    const currentDoc = documentRef.current;
    if (!currentDoc) return;
    setIsUploadingForCopy(true);
    try {
      let contentToCopy = currentDoc;
      try {
        const updatedDoc = await uploadAndReplaceImages(currentDoc, true);
        if (updatedDoc !== currentDoc) {
          updateDocument(updatedDoc);
          contentToCopy = updatedDoc;
        }
      } catch {
        // Cloudinary upload failed — copy original content
      }
      const html = await marked.parse(contentToCopy);
      const blob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([contentToCopy], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob, "text/plain": textBlob }),
      ]);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy as rich text:", error);
    } finally {
      setIsUploadingForCopy(false);
    }
  }, [documentRef, setIsCopied, uploadAndReplaceImages, updateDocument]);

  const handleWriteToReadme = useCallback(
    async (
      writeMode: "write" | "append",
      targetFolder: "explainer" | "problem" | "solution"
    ) => {
      const currentDoc = documentRef.current;
      if (!currentDoc || !lessonId) return;
      setIsWritingToReadme(true);
      try {
        const response = await fetch("/api/write-readme", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId,
            content: currentDoc,
            mode: writeMode,
            targetFolder,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "Failed to write to README");
        }
        const result = await response.json();
        if (result.body && result.body !== currentDoc) {
          updateDocument(result.body);
        }
        toast.success(`Saved to ${targetFolder}/readme.md`);
        revalidate();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to write to README"
        );
      } finally {
        setIsWritingToReadme(false);
      }
    },
    [documentRef, updateDocument, lessonId, revalidate]
  );

  return {
    isWritingToReadme,
    isUploadingImages,
    isUploadingForCopy,
    handleUploadImages,
    handleCopyAsMarkdown,
    handleCopyAsRichText,
    handleWriteToReadme,
  };
}
