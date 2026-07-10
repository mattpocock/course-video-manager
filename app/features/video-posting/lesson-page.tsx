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
  const [generateError, setGenerateError] = useState<string | null>(null);

  const dismissDialog = useCallback(() => {
    setConfirmRegenerate(false);
    setPendingGenerated("");
  }, []);

  const optimisticDescription = descriptionFetcher.formData
    ? String(descriptionFetcher.formData.get("description") ?? "")
    : (description ?? "");

  const optimisticBody = bodyFetcher.formData
    ? String(bodyFetcher.formData.get("body") ?? "")
    : (body ?? "");

  const handleGenerateSeo = useCallback(async () => {
    setIsGeneratingSeo(true);
    setGenerateError(null);
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
        setGenerateError("Failed to generate SEO description");
        return;
      }
      const result = await response.json();
      const text = result.text as string;
      if (!text) return;

      if (optimisticDescription.trim()) {
        setPendingGenerated(text);
        setConfirmRegenerate(true);
      } else {
        persistDescription(text);
      }
    } catch {
      setGenerateError("Failed to generate SEO description");
    } finally {
      setIsGeneratingSeo(false);
    }
  }, [videoId, optimisticDescription, persistDescription]);

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
          <div className="flex items-center gap-2">
            {generateError && (
              <span className="text-sm text-destructive">{generateError}</span>
            )}
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
          if (!open) dismissDialog();
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
            <Button variant="outline" onClick={dismissDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                persistDescription(pendingGenerated);
                dismissDialog();
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
