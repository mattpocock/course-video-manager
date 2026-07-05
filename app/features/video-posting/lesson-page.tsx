"use client";

import { useCallback } from "react";
import { useFetcher } from "react-router";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WriterContext } from "@/features/article-writer/writer-engine";
import { WritableField } from "@/features/article-writer/writable-field";

export function LessonPage({
  videoId,
  body,
  description,
  writerContext,
}: {
  videoId: string;
  body: string | null;
  description: string | null;
  writerContext: WriterContext | null;
}) {
  const bodyFetcher = useFetcher();
  const descriptionFetcher = useFetcher();

  const handleBodyApply = useCallback(
    (newValue: string) => {
      bodyFetcher.submit(
        { intent: "updateBody", body: newValue },
        { method: "post" }
      );
    },
    [bodyFetcher]
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      descriptionFetcher.submit(
        { intent: "updateDescription", description: newValue },
        { method: "post" }
      );
    },
    [descriptionFetcher]
  );

  const optimisticDescription = descriptionFetcher.formData
    ? String(descriptionFetcher.formData.get("description") ?? "")
    : (description ?? "");

  const optimisticBody = bodyFetcher.formData
    ? String(bodyFetcher.formData.get("body") ?? "")
    : (body ?? "");

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
            onApply={handleBodyApply}
            context={writerContext}
            placeholder="Click to open writer..."
          />
        ) : (
          <Textarea
            value={optimisticBody}
            onChange={(e) => {
              bodyFetcher.submit(
                { intent: "updateBody", body: e.target.value },
                { method: "post" }
              );
            }}
            placeholder="Write your lesson body in markdown..."
            className="min-h-[300px] resize-y font-mono"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="video-description">SEO Description</Label>
        <Textarea
          id="video-description"
          value={optimisticDescription}
          onChange={handleDescriptionChange}
          placeholder="Write a short SEO description for this lesson..."
          className="min-h-[100px] resize-y"
          rows={3}
        />
      </div>
    </div>
  );
}
