"use client";

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2Icon, SparklesIcon } from "lucide-react";

type LessonWriterData = {
  body: string | null;
  description: string | null;
};

/**
 * A focused modal for the video's SEO description: shows the current value, a
 * Generate button (driven by the lesson body only), and Save. Mount
 * conditionally so each open starts from a fresh fetch.
 */
export function GenerateSeoDescriptionModal({
  videoId,
  open,
  onOpenChange,
}: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dataFetcher = useFetcher<LessonWriterData>();
  const genFetcher = useFetcher<{ text?: string; error?: string }>();
  const saveFetcher = useFetcher();

  const [value, setValue] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (open && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load(`/api/videos/${videoId}/lesson-writer`);
    }
  }, [open, videoId, dataFetcher]);

  // Seed the textarea from the persisted description once, when data lands.
  useEffect(() => {
    if (dataFetcher.data && !seeded) {
      setValue(dataFetcher.data.description ?? "");
      setSeeded(true);
    }
  }, [dataFetcher.data, seeded]);

  // A completed generation always replaces the textarea contents.
  useEffect(() => {
    if (genFetcher.data?.text != null) {
      setValue(genFetcher.data.text);
    }
  }, [genFetcher.data]);

  const isLoading = !dataFetcher.data;
  const isGenerating = genFetcher.state !== "idle";
  const bodyIsEmpty = dataFetcher.data
    ? !(dataFetcher.data.body ?? "").trim()
    : false;

  const handleGenerate = () => {
    genFetcher.submit(
      {},
      {
        method: "post",
        action: `/api/videos/${videoId}/generate-seo-from-body`,
        encType: "application/json",
      }
    );
  };

  const handleSave = () => {
    saveFetcher.submit(
      { intent: "updateDescription", description: value },
      { method: "post", action: `/api/videos/${videoId}/lesson-writer` }
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>SEO Description</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="A short, compelling SEO description…"
              className="min-h-[120px] text-sm"
              disabled={isGenerating}
              autoFocus
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={cn(
                  "text-muted-foreground",
                  value.length > 160 && "text-destructive"
                )}
              >
                {value.length}/160 characters
              </span>
            </div>

            {bodyIsEmpty && (
              <p className="text-sm text-destructive">
                The lesson body is empty. Write a lesson body before generating.
              </p>
            )}
            {genFetcher.data?.error && (
              <p className="text-sm text-destructive">
                {genFetcher.data.error}
              </p>
            )}

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={handleGenerate}
                disabled={bodyIsEmpty || isGenerating}
              >
                {isGenerating ? (
                  <Loader2Icon className="mr-1 size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="mr-1 size-4" />
                )}
                Generate
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isGenerating}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
