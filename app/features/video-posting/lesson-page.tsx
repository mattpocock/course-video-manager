"use client";

import { useCallback, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import type { WriterContext } from "@/features/article-writer/writer-engine";
import { WritableField } from "@/features/article-writer/writable-field";

export function LessonPage({
  videoId,
  body,
  description,
  writerContext,
  onAddFileFromClipboard,
}: {
  videoId: string;
  body: string | null;
  description: string | null;
  writerContext: WriterContext | null;
  onAddFileFromClipboard?: () => void;
}) {
  const bodyFetcher = useFetcher();
  const descriptionFetcher = useFetcher();

  const persistBody = useCallback(
    (newValue: string) => {
      bodyFetcher.submit(
        { intent: "updateBody", body: newValue },
        { method: "post" }
      );
    },
    [bodyFetcher]
  );

  const persistDescription = useCallback(
    (newValue: string) => {
      descriptionFetcher.submit(
        { intent: "updateDescription", description: newValue },
        { method: "post" }
      );
    },
    [descriptionFetcher]
  );

  const [isGeneratingSeo, setIsGeneratingSeo] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [pendingGenerated, setPendingGenerated] = useState("");

  const optimisticDescription = descriptionFetcher.formData
    ? String(descriptionFetcher.formData.get("description") ?? "")
    : (description ?? "");

  const optimisticBody = bodyFetcher.formData
    ? String(bodyFetcher.formData.get("body") ?? "")
    : (body ?? "");

  const generateSeoDescription = useCallback(async () => {
    setIsGeneratingSeo(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "seo-description",
          enabledFiles: [],
          includeTranscript: true,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to generate SEO description");
      }
      const result = await response.json();
      return result.text as string;
    } finally {
      setIsGeneratingSeo(false);
    }
  }, [videoId]);

  const handleGenerateSeo = useCallback(async () => {
    const text = await generateSeoDescription();
    if (!text) return;

    if (optimisticDescription.trim()) {
      setPendingGenerated(text);
      setConfirmRegenerate(true);
    } else {
      persistDescription(text);
    }
  }, [generateSeoDescription, optimisticDescription, persistDescription]);

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-lg font-semibold">Lesson Content</h2>

      <div className="space-y-2">
        <Label>Body (Markdown)</Label>
        {writerContext ? (
          <WritableField
            videoId={videoId}
            fieldId="video-body"
            value={optimisticBody}
            onChange={persistBody}
            onApply={persistBody}
            context={writerContext}
            modes={["article", "skill-building"]}
            placeholder="Write your lesson body in markdown..."
            onAddFileFromClipboard={onAddFileFromClipboard}
            pageFields={[
              {
                id: "seo-description",
                label: "SEO Description",
                value: optimisticDescription,
              },
            ]}
          />
        ) : (
          <Textarea
            value={optimisticBody}
            onChange={(e) => persistBody(e.target.value)}
            placeholder="Write your lesson body in markdown..."
            className="h-[280px] resize-y font-mono"
          />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>SEO Description</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSeo}
            disabled={isGeneratingSeo}
          >
            {isGeneratingSeo ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </div>
        {writerContext ? (
          <WritableField
            videoId={videoId}
            fieldId="video-description"
            value={optimisticDescription}
            onChange={persistDescription}
            onApply={persistDescription}
            context={writerContext}
            modes={["seo-description-document"]}
            height={160}
            placeholder="Write a short SEO description for this lesson..."
            onAddFileFromClipboard={onAddFileFromClipboard}
            pageFields={[
              {
                id: "body",
                label: "Lesson Body",
                value: optimisticBody,
              },
            ]}
          />
        ) : (
          <Textarea
            value={optimisticDescription}
            onChange={(e) => persistDescription(e.target.value)}
            placeholder="Write a short SEO description for this lesson..."
            className="h-[160px] resize-y"
          />
        )}
      </div>

      <Dialog
        open={confirmRegenerate}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmRegenerate(false);
            setPendingGenerated("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace description?</DialogTitle>
            <DialogDescription>
              The SEO description field already has content. Do you want to
              replace it with the newly generated text?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmRegenerate(false);
                setPendingGenerated("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                persistDescription(pendingGenerated);
                setConfirmRegenerate(false);
                setPendingGenerated("");
              }}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
