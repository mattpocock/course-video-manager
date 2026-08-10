"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Loader2Icon,
  SparklesIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { marked } from "marked";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import type { CourseStructure } from "@/components/video-context-panel";

const NEWSLETTER_STORAGE_KEY = (videoId: string) =>
  `newsletter-content-${videoId}`;

export interface NewsletterPagePanelProps {
  videoId: string;
  chapters: SectionWithWordCount[];
  enabledSections: Set<string>;
  enabledFiles: Set<string>;
  includeTranscript: boolean;
  includeCourseStructure: boolean;
  courseStructure: CourseStructure | null;
  kitSequenceUrl: string;
}

export const NewsletterPagePanel = (props: NewsletterPagePanelProps) => {
  const {
    videoId,
    chapters,
    enabledSections,
    enabledFiles,
    includeTranscript,
    includeCourseStructure,
    courseStructure,
    kitSequenceUrl,
  } = props;

  // Newsletter content state with localStorage persistence
  const [newsletterContent, setNewsletterContent] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(NEWSLETTER_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // Auto-save newsletter content to localStorage
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NEWSLETTER_STORAGE_KEY(videoId), newsletterContent);
    }
  }, [newsletterContent, videoId]);

  // Newsletter generation state
  const [isGenerating, setIsGenerating] = useState(false);

  // AI Hero URL input - pre-filled from localStorage slug if available
  const [aiHeroUrl, setAiHeroUrl] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const slug = localStorage.getItem(`ai-hero-slug-${videoId}`);
      return slug ? `https://aihero.dev/${slug}` : "";
    }
    return "";
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const transcriptEnabled =
        chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;

      const response = await fetch(`/videos/${videoId}/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "1",
              role: "user",
              parts: [{ type: "text", text: "Generate a newsletter." }],
            },
          ],
          mode: "newsletter",
          model: "claude-sonnet-4-20250514",
          enabledFiles: Array.from(enabledFiles),
          includeTranscript: transcriptEnabled,
          enabledSections: Array.from(enabledSections),
          courseStructure:
            includeCourseStructure && courseStructure
              ? courseStructure
              : undefined,
          aiHeroUrl: aiHeroUrl.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate newsletter");
      }

      // Read the streaming response to completion and extract the assistant message text
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Parse the streamed UI message format to extract assistant text
      // The stream uses data: lines with JSON payloads
      let assistantText = "";
      const lines = fullText.split("\n");
      for (const line of lines) {
        if (line.startsWith("0:")) {
          // Text delta lines start with "0:" followed by a JSON string
          try {
            const text = JSON.parse(line.slice(2));
            if (typeof text === "string") {
              assistantText += text;
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      if (assistantText) {
        setNewsletterContent(assistantText);
      }
    } catch (error) {
      console.error("Failed to generate newsletter:", error);
      toast.error("Failed to generate newsletter");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyAndOpenKit = async () => {
    try {
      const html = await marked.parse(newsletterContent);
      const blob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([newsletterContent], { type: "text/plain" });

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blob,
          "text/plain": textBlob,
        }),
      ]);

      toast("Newsletter copied as rich text");
      window.open(kitSequenceUrl, "_blank");
    } catch (error) {
      console.error("Failed to copy as rich text:", error);
      toast.error("Failed to copy newsletter");
    }
  };

  return (
    <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        {/* AI Hero URL input */}
        <div className="space-y-2">
          <Label htmlFor="ai-hero-url">AI Hero Post URL</Label>
          <Input
            id="ai-hero-url"
            type="url"
            value={aiHeroUrl}
            onChange={(e) => setAiHeroUrl(e.target.value)}
            placeholder="https://aihero.dev/your-post-slug"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="newsletter-content">Newsletter</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating || !aiHeroUrl.trim()}
            >
              {isGenerating ? (
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
          <Textarea
            id="newsletter-content"
            value={newsletterContent}
            onChange={(e) => setNewsletterContent(e.target.value)}
            placeholder="Newsletter content will appear here after generation..."
            className="min-h-[400px] resize-y"
          />
        </div>

        {/* Copy & Open Kit button */}
        <div className="space-y-3">
          <Button
            onClick={handleCopyAndOpenKit}
            disabled={!newsletterContent.trim()}
            className="w-full"
            size="lg"
          >
            <ClipboardCopyIcon className="h-4 w-4" />
            Copy & Open Kit
            <ExternalLinkIcon className="h-4 w-4" />
          </Button>

          {!newsletterContent.trim() && (
            <p className="text-sm text-muted-foreground text-center">
              Generate or write newsletter content first.
            </p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Copies newsletter as rich text to clipboard and opens Kit sequence
            editor.
          </p>
        </div>
      </div>
    </div>
  );
};
